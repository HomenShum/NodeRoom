/* ============================================================================
   NodeAgent Mobile — icon set (lucide-style, 1.75 stroke, currentColor)
   → window.NAIcon  ·  <NAIcon name="..." />
   ============================================================================ */
(function () {
  const P = (d, extra) => React.createElement('path', Object.assign({ d, fill: 'none' }, extra || {}));
  const make = (...children) => (props) =>
    React.createElement('svg', Object.assign(
      { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75,
        strokeLinecap: 'round', strokeLinejoin: 'round' }, props || {}), ...children);

  const ICONS = {
    pen: make(P('M12 20h9'), P('M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z')),
    inbox: make(P('M22 12h-6l-2 3h-4l-2-3H2'), P('M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z')),
    room: make(P('M3 21h18'), P('M5 21V7l8-4v18'), P('M19 21V11l-6-4'), P('M9 9v.01'), P('M9 12v.01'), P('M9 15v.01')),
    coach: make(P('M12 2 2 7l10 5 10-5-10-5Z'), P('M6 9.5V15c0 1.1 2.7 3 6 3s6-1.9 6-3V9.5')),
    building: make(P('M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z'), P('M10 6h4'), P('M10 10h4'), P('M10 14h4'), P('M2 22h20')),
    user: make(React.createElement('circle', { cx: 12, cy: 8, r: 4 }), P('M4 21a8 8 0 0 1 16 0')),
    signal: make(P('M2 20h.01'), P('M7 20v-4'), P('M12 20v-8'), P('M17 20V8'), P('M22 4v16')),
    gap: make(React.createElement('circle', { cx: 12, cy: 12, r: 9, strokeDasharray: '3 3' }), P('M12 8v4'), P('M12 16h.01')),
    sparkles: make(P('M12 3 13.9 8.6 19.5 10.5 13.9 12.4 12 18 10.1 12.4 4.5 10.5 10.1 8.6Z'), P('M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z')),
    arrowRight: make(P('M5 12h14'), P('M13 5l7 7-7 7')),
    check: make(P('M20 6 9 17l-5-5')),
    checkCircle: make(React.createElement('circle', { cx: 12, cy: 12, r: 9 }), P('M8.5 12.5 11 15l4.5-5')),
    x: make(P('M18 6 6 18'), P('M6 6l12 12')),
    eye: make(P('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z'), React.createElement('circle', { cx: 12, cy: 12, r: 3 })),
    eyeOff: make(P('M10.7 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-2 2.8'), P('M6.6 6.6A13.3 13.3 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 4-.9'), P('M9.9 9.9a3 3 0 0 0 4.2 4.2'), P('M2 2l20 20')),
    lock: make(React.createElement('rect', { x: 4, y: 11, width: 16, height: 10, rx: 2 }), P('M8 11V7a4 4 0 0 1 8 0v4')),
    shield: make(P('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z')),
    search: make(React.createElement('circle', { cx: 11, cy: 11, r: 7 }), P('M21 21l-4-4')),
    table: make(React.createElement('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }), P('M3 9h18'), P('M3 15h18'), P('M9 3v18')),
    plus: make(P('M12 5v14'), P('M5 12h14')),
    bolt: make(P('M13 2 3 14h7l-1 8 10-12h-7l1-8Z')),
    clock: make(React.createElement('circle', { cx: 12, cy: 12, r: 9 }), P('M12 7v5l3 2')),
    dollar: make(P('M12 2v20'), P('M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5 9.2 9.5 12 9.5s5 1.1 5 3-2.2 3-5 3-5-1.1-5-3')),
    route: make(React.createElement('circle', { cx: 6, cy: 19, r: 3 }), React.createElement('circle', { cx: 18, cy: 5, r: 3 }), P('M9 19h5a4 4 0 0 0 4-4V8')),
    history: make(P('M3 12a9 9 0 1 0 3-6.7L3 8'), P('M3 4v4h4'), P('M12 8v4l3 2')),
    file: make(P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z'), P('M14 2v6h6')),
    note: make(P('M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z'), P('M16 3v5h5'), P('M8 13h6'), P('M8 17h4')),
    bell: make(P('M6 9a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8'), P('M10.3 21a1.94 1.94 0 0 0 3.4 0')),
    quote: make(P('M7 7H4v6h6V7H7l1-3'), P('M17 7h-3v6h6V7h-3l1-3')),
    target: make(React.createElement('circle', { cx: 12, cy: 12, r: 9 }), React.createElement('circle', { cx: 12, cy: 12, r: 5 }), React.createElement('circle', { cx: 12, cy: 12, r: 1 })),
    refresh: make(P('M21 12a9 9 0 1 1-3-6.7'), P('M21 3v5h-5')),
    chevR: make(P('M9 18l6-6-6-6')),
    users: make(React.createElement('circle', { cx: 9, cy: 8, r: 3.5 }), P('M2 21a7 7 0 0 1 14 0'), P('M16 4.5a3.5 3.5 0 0 1 0 7'), P('M22 21a7 7 0 0 0-5-6.7')),
    mic: make(React.createElement('rect', { x: 9, y: 3, width: 6, height: 11, rx: 3 }), P('M5 11a7 7 0 0 0 14 0'), P('M12 18v3')),
    link: make(P('M10 14a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1'), P('M14 10a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1')),
    settings: make(React.createElement('circle', { cx: 12, cy: 12, r: 3 }), P('M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6h.1A1.6 1.6 0 0 0 8.7 1.1V1a2 2 0 0 1 4 0v.1A1.6 1.6 0 0 0 17 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H23a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.1Z')),
  };

  function NAIcon({ name, ...rest }) {
    const C = ICONS[name];
    return C ? C(rest) : null;
  }
  window.NAIcon = NAIcon;
})();
