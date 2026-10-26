// client/src/components/GarmentErrorBoundary.jsx
//
// Одна вещь в 3D-сцене не загрузилась (файла нет, битый GLB) — без границы ошибка
// роняет всю сцену вместе с телом. Здесь вещь просто не рисуется, а страница
// узнаёт адрес через onError и ставит вместо неё шаблон (utils/garmentTemplates.js).

import React from 'react';

export default class GarmentErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    this.props.onError?.(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
