/* Lucide-style stroke icons (1.75px, currentColor). Exported to window.NAIcon */
(function () {
  const P = (d) => d;
  function mk(paths, vb) {
    return function Icon(props) {
      const size = (props && props.size) || 18;
      return React.createElement('svg', {
        width: size, height: size, viewBox: vb || '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round',
        ...(props || {}),
      }, paths.map((d, i) => React.createElement('path', { key: i, d })));
    };
  }
  const paths = {
    play: [P('M6 4l13 8-13 8z')],
    bolt: [P('M13 2L4.5 13.5H11l-1 8 8.5-11.5H12z')],
    file: [P('M14 3v5h5'), P('M7 3h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z'), P('M9 13h6'), P('M9 17h4')],
    table: [P('M3 5h18v14H3z'), P('M3 10h18'), P('M9 10v9'), P('M3 15h18')],
    graph: [P('M6 3v12'), P('M18 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'), P('M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'), P('M6 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'), P('M15 12H9')],
    shield: [P('M12 3l8 3v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z'), P('M9 12l2 2 4-4')],
    sun: [P('M12 4V2'), P('M12 22v-2'), P('M5 5L3.5 3.5'), P('M20.5 20.5L19 19'), P('M4 12H2'), P('M22 12h-2'), P('M5 19l-1.5 1.5'), P('M20.5 3.5L19 5'), P('M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z')],
    moon: [P('M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z')],
    sliders: [P('M4 6h10'), P('M18 6h2'), P('M16 6a1.5 1.5 0 1 0 0 0.01'), P('M4 12h2'), P('M10 12h10'), P('M8 12a1.5 1.5 0 1 0 0 0.01'), P('M4 18h12'), P('M20 18h0'), P('M18 18a1.5 1.5 0 1 0 0 0.01')],
    check: [P('M5 12.5l4.5 4.5L19 7')],
    alert: [P('M12 4l9 16H3z'), P('M12 10v4'), P('M12 17.5v.5')],
    copy: [P('M9 9h11v11H9z'), P('M5 15H4V4h11v1')],
    replay: [P('M4 12a8 8 0 1 0 2.5-5.8'), P('M4 4v4h4')],
    layers: [P('M12 3l9 5-9 5-9-5z'), P('M3 13l9 5 9-5'), P('M3 18l9 5 9-5')],
    chat: [P('M4 5h16v11H9l-5 4z')],
    db: [P('M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z'), P('M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6'), P('M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6')],
    arrow: [P('M5 12h14'), P('M13 6l6 6-6 6')],
    lock: [P('M6 11h12v9H6z'), P('M9 11V8a3 3 0 0 1 6 0v3')],
    gate: [P('M4 4v16'), P('M20 4v16'), P('M9 8l3 4-3 4'), P('M15 8l-3 4 3 4')],
    search: [P('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z'), P('M20 20l-4-4')],
    dot: [P('M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z')],
    cpu: [P('M7 7h10v10H7z'), P('M9 3v2'), P('M15 3v2'), P('M9 19v2'), P('M15 19v2'), P('M3 9h2'), P('M3 15h2'), P('M19 9h2'), P('M19 15h2')],
    route: [P('M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'), P('M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'), P('M8 17h6a3 3 0 0 0 3-3V9'), P('M6 15V8a1 1 0 0 1 1-1h3')],
  };
  const NAIcon = {};
  Object.keys(paths).forEach((k) => { NAIcon[k] = mk(paths[k]); });
  window.NAIcon = NAIcon;
})();
