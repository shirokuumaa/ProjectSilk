from pathlib import Path
import trimesh

def export_trimesh_to_glb(mesh: trimesh.Trimesh, glb_path: Path):
    # минимальный экспорт в glb (без сложных материаллов)
    # trimesh умеет сохранять прямо в glb
    mesh.export(glb_path, file_type="glb")