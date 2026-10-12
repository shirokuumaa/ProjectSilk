# scripts/avatar/calibrate.py
#
# Калибровка болванки: какие значения морфов дают заданные сантиметры.
# Работает по самому файлу base_avatar.glb (то, что увидит покупатель).
# Запуск: python3 scripts/avatar/calibrate.py  (или из build.sh).
#
#  1. Снимаем обмеры с ~1500 случайных фигур и подгоняем по ним компактную
#     модель «веса ключей → сантиметры» (многочлен 2-й степени по 16 ключам).
#  2. Подбор морфов — несколько итераций линейной поправки (Гаусс–Ньютон)
#     с границами и слабой регуляризацией. Тот же алгоритм будет в браузере.
#  3. Проверка на настоящем меше: тестовые фигуры, случайные достижимые
#     фигуры, случайные реалистичные фигуры (в том числе вне диапазона).
#  4. Результат — client/src/data/avatarCalibration.json и out/report.md.

import datetime
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402
import glb  # noqa: E402
import measure  # noqa: E402

M = config.MEASURES
C = config.CONTROL_NAMES
RNG = np.random.default_rng(20261012)


def log(*args):
    print("[calibrate]", *args, flush=True)


# ── модель «ключи → сантиметры» ─────────────────────────────────

class Surrogate:
    """f(k) = c0 + Σ c_i k_i + Σ c_ij k_i k_j; пары incr×decr одного морфа не бывают одновременно и исключены."""

    def __init__(self):
        n = len(config.KEY_NAMES)
        self.pairs = [(i, j) for i in range(n) for j in range(i, n) if i == j or i // 2 != j // 2]
        self.coef = None

    def features(self, K):
        K = np.atleast_2d(K)
        quad = K[:, [i for i, _ in self.pairs]] * K[:, [j for _, j in self.pairs]]
        return np.hstack([np.ones((len(K), 1)), K, quad])

    def fit(self, U, Y):
        K = np.array([measure.key_weights(u) for u in U])
        self.coef, *_ = np.linalg.lstsq(self.features(K), Y, rcond=None)

    def __call__(self, u):
        return (self.features(measure.key_weights(u)) @ self.coef)[0]


class TrueModel:
    def __init__(self, body):
        self.body = body
        self.calls = 0

    def __call__(self, u):
        self.calls += 1
        r = self.body.measure(u)
        return np.array([r[m] for m in M])


# ── подбор морфов ────────────────────────────────────────────────

def solve(model, targets, limits=None, reg=None, iterations=30, h=1e-3):
    """Значения 8 морфов под заданные обмеры (см). Отсутствующие обмеры (None) не учитываются."""
    limits = limits or config.CONTROL_LIMITS
    reg = reg or config.REGULARIZATION
    lo = np.array([limits[c][0] for c in C])
    hi = np.array([limits[c][1] for c in C])
    lam = np.sqrt(np.array([reg[c] for c in C]))
    rows = [i for i, m in enumerate(M) if targets.get(m) is not None]
    t = np.array([float(targets[M[i]]) for i in rows])

    def cost(u):
        return float(((model(u)[rows] - t) ** 2).sum() + ((lam * u) ** 2).sum())

    u = np.zeros(len(C))
    side = np.ones(len(C))                       # с какой стороны брать производную в нуле
    for _ in range(iterations):
        f = model(u)[rows]

        def column(i):
            s = np.sign(u[i]) if u[i] != 0 else side[i]
            if not lo[i] <= u[i] + s * h <= hi[i]:   # у границы — производная с внутренней стороны
                s = -s
            e = np.zeros(len(C))
            e[i] = s * h
            return (model(u + e)[rows] - f) / (s * h)

        J = np.column_stack([column(i) for i in range(len(C))])
        du = _step(J, t - f, u, lam, lo, hi)
        flip = (u == 0) & (np.sign(du) != side) & (np.abs(du) > 1e-9)
        if flip.any():                           # в нуле пошли в другую сторону — пересчитываем производную
            side[flip] *= -1
            for i in np.flatnonzero(flip):
                J[:, i] = column(i)
            du = _step(J, t - f, u, lam, lo, hi)

        base = cost(u)
        for _ in range(8):                       # шаг не должен ухудшать результат
            cand = np.clip(u + du, lo, hi)
            if cost(cand) <= base:
                break
            du *= 0.5
        else:
            break
        moved = np.abs(cand - u).max()
        u = cand
        if moved < 1e-5:
            break

    f = model(u)
    residual = {M[i]: float(f[i] - targets[M[i]]) for i in rows}
    return u, f, residual


def _step(J, r, u, lam, lo, hi):
    """Линейная поправка с регуляризацией.

    Морф, который уже стоит на границе и тянется наружу, фиксируется; шаг
    остальных укорачивается так, чтобы не выйти за границы (дальше — на
    следующей итерации). Так промежуточный «перелёт» не залипает на границе.
    """
    n = len(u)
    at_lo, at_hi = u <= lo + 1e-12, u >= hi - 1e-12
    fixed = np.zeros(n, bool)
    du = np.zeros(n)
    for _ in range(n + 1):
        free = ~fixed
        du[:] = 0.0
        A = np.vstack([J[:, free], np.diag(lam[free])])
        b = np.concatenate([r, -lam[free] * u[free]])
        du[free] = np.linalg.lstsq(A, b, rcond=None)[0]
        outward = free & ((at_lo & (du < 0)) | (at_hi & (du > 0)))
        if not outward.any():
            break
        fixed |= outward
    with np.errstate(divide="ignore", invalid="ignore"):
        room = np.where(du > 0, (hi - u) / du, np.where(du < 0, (lo - u) / du, np.inf))
    return du * min(1.0, float(room.min()))


# ── выборки ──────────────────────────────────────────────────────

def random_controls(n):
    lo = np.array([config.CONTROL_LIMITS[c][0] for c in C])
    hi = np.array([config.CONTROL_LIMITS[c][1] for c in C])
    U = RNG.uniform(lo, hi, size=(n, len(C)))
    # часть морфов чаще стоит в нуле, как у реальных фигур
    U[RNG.random(U.shape) < 0.25] = 0.0
    return U


def sweeps(steps=11):
    out = []
    for i, c in enumerate(C):
        for v in np.linspace(*config.CONTROL_LIMITS[c], steps):
            u = np.zeros(len(C))
            u[i] = v
            out.append(u)
    return np.array(out)


def realistic_targets(n):
    """Широкий разброс женских фигур, включая заведомо недостижимые."""
    out = []
    for _ in range(n):
        h = RNG.uniform(145, 185)
        bust = RNG.uniform(74, 130)
        waist = bust - RNG.uniform(8, 28)
        hips = bust + RNG.uniform(-4, 16)
        out.append({
            "height": h, "bust": bust, "waist": waist, "hips": hips,
            "shoulder": 0.24 * h + RNG.uniform(-3, 3),
            "arm_length": 0.345 * h + RNG.uniform(-3, 3),
            "inseam": 0.455 * h + RNG.uniform(-3, 3),
        })
    return out


def r6(x):
    return float(f"{x:.6g}")


# ── основной сценарий ───────────────────────────────────────────

def main():
    t0 = time.time()
    info = json.loads(config.BUILD_INFO_PATH.read_text())
    body = measure.Body(glb.load_body(config.GLB_PATH), info["landmarks"])
    truth = TrueModel(body)
    neutral = truth(np.zeros(len(C)))
    log("neutral", dict(zip(M, neutral.round(2))))

    # 1. модель по случайным фигурам
    U_fit = np.vstack([random_controls(1500), sweeps()])
    Y_fit = np.array([truth(u) for u in U_fit])
    U_hold = random_controls(300)
    Y_hold = np.array([truth(u) for u in U_hold])
    sur = Surrogate()
    sur.fit(U_fit, Y_fit)
    err = np.array([sur(u) for u in U_hold]) - Y_hold
    fit_error = {m: {"rmsCm": round(float(np.sqrt((err[:, i] ** 2).mean())), 3),
                     "maxCm": round(float(np.abs(err[:, i]).max()), 3)} for i, m in enumerate(M)}
    log("surrogate holdout error", fit_error, f"({time.time() - t0:.0f}s)")
    margin = max(v["maxCm"] for v in fit_error.values())
    accept = round(max(0.5, config.TOLERANCE_CM - margin), 2)

    # 2. достижимые границы по каждому обмеру (остальные свободны)
    reach = {}
    for m in M:
        ends = []
        for target in (-1000.0, 1000.0):
            u, _, _ = solve(sur, {m: target})
            ends.append(round(float(truth(u)[M.index(m)]), 1))
        reach[m] = ends
    log("reachable", reach)

    # 3. тестовые фигуры: путь как в приложении (модель) + точный подбор по мешу для сравнения
    tests = {}
    for name, target in config.TEST_FIGURES.items():
        u, pred, res = solve(sur, target)
        got = truth(u)
        ue, fe, rese = solve(truth, target)
        tests[name] = {
            "requested": target,
            "controls": dict(zip(C, map(r6, u))),
            "predictedResidualCm": {k: round(v, 2) for k, v in res.items()},
            "actual": dict(zip(M, (round(float(x), 2) for x in got))),
            "errorCm": {m: round(float(got[i] - target[m]), 2) for i, m in enumerate(M)},
            "inRange": bool(max(abs(v) for v in res.values()) <= accept),
            "exactSolver": {"controls": dict(zip(C, map(r6, ue))),
                            "errorCm": {k: round(v, 2) for k, v in rese.items()}},
        }
        log(name, "in range" if tests[name]["inRange"] else "OUT OF RANGE",
            "max |error|", max(abs(v) for v in tests[name]["errorCm"].values()),
            "exact solver max |error|", round(max(abs(v) for v in rese.values()), 2))

    # 4. случайные достижимые фигуры: модель + подбор должны попадать в допуск
    reachable_err = []
    for u_true in random_controls(200):
        target = dict(zip(M, truth(u_true)))
        u, _, _ = solve(sur, target)
        reachable_err.append(np.abs(truth(u) - np.array([target[m] for m in M])))
    reachable_err = np.array(reachable_err)

    # 5. реалистичные фигуры: правило «в диапазоне» не должно пропускать ошибку > допуска
    def realistic(keys, n):
        rows = []
        for target in realistic_targets(n):
            target = {m: (target[m] if m in keys else None) for m in M}
            u, _, res = solve(sur, target)
            ok = max(abs(v) for v in res.values()) <= accept
            got = truth(u)
            true_err = max(abs(got[i] - target[m]) for i, m in enumerate(M) if target[m] is not None)
            rows.append((ok, true_err))
        rows = np.array(rows)
        inside = rows[rows[:, 0] == 1, 1]
        return {"figures": int(n), "inRange": int(len(inside)),
                "maxErrorInRangeCm": round(float(inside.max()), 2) if len(inside) else None,
                "p95ErrorInRangeCm": round(float(np.percentile(inside, 95)), 2) if len(inside) else None}

    realistic_all = realistic(set(M), 300)
    realistic_req = realistic({"height", "bust", "waist", "hips"}, 300)
    log("realistic (all 7)", realistic_all, "realistic (4 required)", realistic_req)

    calibration = {
        "version": 1,
        "generated": datetime.date.today().isoformat(),
        "model": "/models/base_avatar.glb",
        "units": "cm",
        "source": {"generator": "MPFB 2.0.18 (MakeHuman assets, CC0)", "macros": info["macros"],
                   "targets": info["mpfb_targets"]},
        "controls": C,
        "keys": config.KEY_NAMES,
        "keyRule": "control u > 0 → <name>_incr = u; u < 0 → <name>_decr = -u",
        "measures": M,
        "definitions": measure.DEFINITIONS,
        "waistLevel": round(body.waist_level, 4),
        "hipLevel": round(body.hip_level, 4),
        "neutral": dict(zip(M, (round(float(x), 2) for x in neutral))),
        "limits": config.CONTROL_LIMITS,
        "surrogate": {
            "type": "quadratic",
            "features": "[1, k_0..k_15, k_i*k_j for (i, j) in pairs]; k = 16 key weights in 'keys' order",
            "pairs": sur.pairs,
            "coefficients": {m: [r6(x) for x in sur.coef[:, i]] for i, m in enumerate(M)},
            "holdoutError": fit_error,
        },
        "solver": {
            "method": "Gauss-Newton with box limits, one-sided finite differences at 0, step halving",
            "iterations": 30, "fdStep": 1e-3, "regularization": config.REGULARIZATION,
        },
        "range": {
            "toleranceCm": config.TOLERANCE_CM,
            "acceptResidualCm": accept,
            "rule": "Solve with the surrogate; if any |predicted residual| > acceptResidualCm, the figure is out of range → show BodyAvatar.",
            "reachableCm": reach,
        },
        "landmarks": {name: [int(i) for i in ids] for name, ids in body.landmarks.items()},
        "validation": {
            "testFigures": tests,
            "randomReachable": {"figures": len(reachable_err),
                                "maxErrorCm": dict(zip(M, (round(float(x), 2) for x in reachable_err.max(0)))),
                                "p95ErrorCm": dict(zip(M, (round(float(x), 2) for x in np.percentile(reachable_err, 95, axis=0))))},
            "realisticAll7": realistic_all,
            "realistic4Required": realistic_req,
        },
    }
    config.CALIBRATION_PATH.parent.mkdir(parents=True, exist_ok=True)
    config.CALIBRATION_PATH.write_text(json.dumps(calibration, indent=1) + "\n")
    write_report(calibration)
    log(f"wrote {config.CALIBRATION_PATH} ({config.CALIBRATION_PATH.stat().st_size / 1024:.0f} KB), "
        f"{truth.calls} mesh measurements, {time.time() - t0:.0f}s")


def write_report(cal):
    lines = ["# Base avatar calibration", "",
             f"GLB: {config.GLB_PATH.stat().st_size / 1024 / 1024:.2f} MB. Tolerance {cal['range']['toleranceCm']} cm, "
             f"accept residual {cal['range']['acceptResidualCm']} cm.", "",
             "| figure | measure | requested | actual | error |", "|---|---|---|---|---|"]
    for name, t in cal["validation"]["testFigures"].items():
        flag = "in range" if t["inRange"] else "OUT OF RANGE"
        for m in M:
            lines.append(f"| {name} ({flag}) | {m} | {t['requested'][m]} | {t['actual'][m]:.1f} | {t['errorCm'][m]:+.1f} |")
    lines += ["", "Reachable (others free): " + ", ".join(f"{m} {a}–{b}" for m, (a, b) in cal["range"]["reachableCm"].items())]
    (config.OUT_DIR / "report.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
