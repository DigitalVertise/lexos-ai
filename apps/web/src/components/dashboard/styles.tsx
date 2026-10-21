/** Dashboard-scoped CSS (entry animations, online pulse). Respects prefers-reduced-motion. */
export function DashboardStyles() {
  return (
    <style>{`
      @keyframes dv-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      @keyframes dv-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
      @keyframes dv-ping { 0% { transform: scale(1); opacity: .55; } 80%, 100% { transform: scale(2.6); opacity: 0; } }
      .dv-rise { animation: dv-rise .5s cubic-bezier(.2,.7,.2,1) both; animation-delay: calc(var(--i, 0) * 60ms); }
      .dv-grow { transform-origin: left; animation: dv-grow .9s cubic-bezier(.2,.7,.2,1) .25s both; }
      .dv-ping { animation: dv-ping 2s cubic-bezier(0,0,.2,1) infinite; }
      @media (prefers-reduced-motion: reduce) {
        .dv-rise, .dv-grow, .dv-ping { animation: none !important; }
        .dv-ping { display: none; }
      }
    `}</style>
  );
}
