// client/src/components/FormErrors.jsx
//
// Ошибки формы — все сразу, а не первая из них: одна — абзацем, несколько — списком.
// errors: string | string[]; пустое — ничего не рисуем.
import React from 'react';

export default function FormErrors({ errors, className, style }) {
  const list = (Array.isArray(errors) ? errors : [errors]).filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return <p role="alert" className={className} style={style}>{list[0]}</p>;
  return (
    <ul role="alert" className={className} style={{ margin: 0, paddingLeft: 18, ...style }}>
      {list.map((e) => <li key={e}>{e}</li>)}
    </ul>
  );
}

/** Ошибки из ответа сервера: список errors, если он есть, иначе message. */
export function errorsOf(err) {
  if (Array.isArray(err?.errors) && err.errors.length) return err.errors;
  return err?.message ? [err.message] : ['Something went wrong. Please try again.'];
}
