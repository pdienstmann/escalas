"use client";

export function ModuleLoading({
  area,
  detail,
  fullscreen = true,
}: {
  area: string;
  detail?: string;
  fullscreen?: boolean;
}) {
  const content = (
    <div className="loading-card" role="status" aria-live="polite" aria-busy="true">
      <span className="loading-spinner" aria-hidden="true" />
      <b>Carregando {area}</b>
      <small>{detail || "Aguarde enquanto os dados são sincronizados…"}</small>
    </div>
  );
  if (!fullscreen) return content;
  return <main className="module-loading-screen">{content}</main>;
}

export function ModuleBusyOverlay({
  area,
  active,
}: {
  area: string;
  active: boolean;
}) {
  if (!active) return null;
  return (
    <div className="module-busy-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="loading-card">
        <span className="loading-spinner" aria-hidden="true" />
        <b>Atualizando {area}</b>
        <small>Evite cliques repetidos até concluir.</small>
      </div>
    </div>
  );
}
