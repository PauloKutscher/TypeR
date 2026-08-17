import React from "react";
import { FiX, FiAlertTriangle, FiInfo, FiChevronDown, FiChevronUp } from "react-icons/fi";

const BalloonCenteringDebug = ({ data, onClose }) => {
  if (!data) return null;

  const {
    selectionBounds,
    sampledRows,
    polygons,
    geometryAnalysis,
    renderedTextBounds,
    targetCenter,
    appliedOffset,
    marginX,
    marginY,
    safetyMarginApplied,
    fallbackReason,
    isRectangular,
    hasCompletion,
    ellipseFit,
    cutDetection,
    profileRows,
  } = data;

  const formatNumber = (n) => (typeof n === "number" ? n.toFixed(2) : "—");
  const formatInt = (n) => (typeof n === "number" ? Math.round(n) : "—");

  const Section = ({ title, children, warning, icon }) => (
    <div className="debug-section">
      <div className="debug-section-header">
        {icon && <span className="debug-section-icon">{icon}</span>}
        <span className="debug-section-title">{title}</span>
        {warning && <FiAlertTriangle className="debug-warning-icon" size={12} />}
      </div>
      <div className="debug-section-content">{children}</div>
    </div>
  );

  const Row = ({ label, value, unit, monospace = true }) => (
    <div className="debug-row">
      <span className="debug-label">{label}</span>
      <span className={monospace ? "debug-value-mono" : "debug-value"}>{value} {unit ? <span className="debug-unit">{unit}</span> : null}</span>
    </div>
  );

  const Grid = ({ children, columns = 2 }) => (
    <div className="debug-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>{children}</div>
  );

  const badge = (text, variant = "neutral") => (
    <span className={`debug-badge debug-badge--${variant}`}>{text}</span>
  );

  return (
    <div className="balloon-centering-debug">
      <div className="debug-header">
        <span className="debug-title">Diagnóstico de Centralização</span>
        <button className="debug-close" onClick={onClose} title="Fechar">
          <FiX size={14} />
        </button>
      </div>

      <div className="debug-body">
        {fallbackReason && (
          <Section title="Motivo do Fallback" icon={<FiInfo size={12} />} warning>
            <span className="debug-fallback-reason">{fallbackReason}</span>
          </Section>
        )}

        <Section title="Limites da Seleção" icon={<FiInfo size={12} />}>
          <Grid>
            <Row label="Left" value={formatInt(selectionBounds?.left)} unit="px" />
            <Row label="Top" value={formatInt(selectionBounds?.top)} unit="px" />
            <Row label="Right" value={formatInt(selectionBounds?.right)} unit="px" />
            <Row label="Bottom" value={formatInt(selectionBounds?.bottom)} unit="px" />
            <Row label="Width" value={formatInt(selectionBounds?.width)} unit="px" />
            <Row label="Height" value={formatInt(selectionBounds?.height)} unit="px" />
            <Row label="Centro X" value={formatInt(selectionBounds?.xMid)} unit="px" />
            <Row label="Centro Y" value={formatInt(selectionBounds?.yMid)} unit="px" />
          </Grid>
        </Section>

        <Section title="Análise Geométrica" icon={<FiInfo size={12} />}>
          <Grid>
            <Row label="Formato Retangular" value={isRectangular ? "Sim" : "Não"} monospace={false} />
            <Row label="Tem Completion" value={hasCompletion ? "Sim" : "Não"} monospace={false} />
            {ellipseFit && (
              <>
                <Row label="Elipse Center X" value={formatInt(ellipseFit.centerX)} unit="px" />
                <Row label="Elipse Center Y" value={formatInt(ellipseFit.centerY)} unit="px" />
                <Row label="Semi-eixo A" value={formatInt(ellipseFit.a)} unit="px" />
                <Row label="Semi-eixo B" value={formatInt(ellipseFit.b)} unit="px" />
                <Row label="Ângulo" value={formatNumber(ellipseFit.angle ? (ellipseFit.angle * 180 / Math.PI) : 0)} unit="°" />
                <Row label="Dist. do Centro" value={formatInt(ellipseFit.distFromCenter)} unit="px" />
                <Row label="Aspect Ratio" value={formatNumber(ellipseFit.aspectRatio)} />
                <Row label="Cobertura Angular" value={formatNumber(ellipseFit.angleCoverage ? (ellipseFit.angleCoverage * 180 / Math.PI) : 0)} unit="°" />
              </>
            )}
          </Grid>

          {cutDetection && (
            <div className="debug-cut-detection">
              <strong>Detecção de Corte:</strong>
              <div className="debug-cut-flags">
                {cutDetection.isLeftCut && badge("Corte Esquerda", "cut")}
                {cutDetection.isRightCut && badge("Corte Direita", "cut")}
                {cutDetection.isTopCut && badge("Corte Topo", "cut")}
                {cutDetection.isBottomCut && badge("Corte Base", "cut")}
                {!cutDetection.isLeftCut && !cutDetection.isRightCut && !cutDetection.isTopCut && !cutDetection.isBottomCut && badge("Sem Corte", "ok")}
              </div>
              <Grid columns={4}>
                <Row label="Left Cut Ratio" value={formatNumber(cutDetection.leftCutRatio * 100)} unit="%" />
                <Row label="Right Cut Ratio" value={formatNumber(cutDetection.rightCutRatio * 100)} unit="%" />
                <Row label="Visual Centroid X" value={formatNumber(cutDetection.visualCentroidX * 100)} unit="%" />
                <Row label="Visual Centroid Y" value={formatNumber(cutDetection.visualCentroidY * 100)} unit="%" />
                <Row label="Median Mid X" value={formatNumber(cutDetection.medianMid * 100)} unit="%" />
                <Row label="Visible Mid X" value={formatNumber(cutDetection.visibleMidX * 100)} unit="%" />
                <Row label="Target Norm X" value={formatNumber(cutDetection.targetNormX * 100)} unit="%" />
                <Row label="Target Norm Y" value={formatNumber(cutDetection.targetNormY * 100)} unit="%" />
              </Grid>
            </div>
          )}
        </Section>

        <Section title="Linhas Amostradas (21 scans)" icon={<FiInfo size={12} />}>
          {sampledRows && sampledRows.length > 0 ? (
            <div className="debug-rows-table">
              <div className="debug-row-header">
                <span>Y</span>
                <span>Left</span>
                <span>Right</span>
                <span>Width</span>
                <span>Mid</span>
                <span>Weight</span>
              </div>
              {sampledRows.slice(0, 21).map((row, i) => (
                <div key={i} className="debug-row-data">
                  <span>{formatNumber(row.y * 100)}%</span>
                  <span>{formatNumber(row.left * 100)}%</span>
                  <span>{formatNumber(row.right * 100)}%</span>
                  <span>{formatNumber(row.width * 100)}%</span>
                  <span>{formatNumber(((row.left + row.right) / 2) * 100)}%</span>
                  <span>{row.width > 0.05 ? formatNumber(Math.pow(row.width, 1.5)) : "0"}</span>
                </div>
              ))}
            </div>
          ) : (
            <span className="debug-empty">Nenhuma linha amostrada</span>
          )}
        </Section>

        {profileRows && profileRows.length > 0 && (
          <Section title="Linhas de Perfil (Phantom/Reconstruídas)" icon={<FiInfo size={12} />}>
            <div className="debug-rows-table">
              <div className="debug-row-header">
                <span>Y</span>
                <span>Left</span>
                <span>Right</span>
                <span>Width</span>
              </div>
              {profileRows.slice(0, 21).map((row, i) => (
                <div key={i} className="debug-row-data">
                  <span>{formatNumber(row.y * 100)}%</span>
                  <span>{formatNumber(row.left * 100)}%</span>
                  <span>{formatNumber(row.right * 100)}%</span>
                  <span>{formatNumber(row.width * 100)}%</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="Limites do Texto Renderizado" icon={<FiInfo size={12} />}>
          <Grid>
            <Row label="Left" value={formatInt(renderedTextBounds?.left)} unit="px" />
            <Row label="Top" value={formatInt(renderedTextBounds?.top)} unit="px" />
            <Row label="Right" value={formatInt(renderedTextBounds?.right)} unit="px" />
            <Row label="Bottom" value={formatInt(renderedTextBounds?.bottom)} unit="px" />
            <Row label="Width" value={formatInt(renderedTextBounds?.width)} unit="px" />
            <Row label="Height" value={formatInt(renderedTextBounds?.height)} unit="px" />
            <Row label="Centro X" value={formatInt(renderedTextBounds?.xMid)} unit="px" />
            <Row label="Centro Y" value={formatInt(renderedTextBounds?.yMid)} unit="px" />
          </Grid>
        </Section>

        <Section title="Posicionamento Final" icon={<FiInfo size={12} />}>
          <Grid>
            <Row label="Target Center X" value={formatInt(targetCenter?.x)} unit="px" />
            <Row label="Target Center Y" value={formatInt(targetCenter?.y)} unit="px" />
            <Row label="Applied Offset X" value={formatInt(appliedOffset?.x)} unit="px" />
            <Row label="Applied Offset Y" value={formatInt(appliedOffset?.y)} unit="px" />
            <Row label="Margem X aplicada" value={formatInt(marginX)} unit="px" />
            <Row label="Margem Y aplicada" value={formatInt(marginY)} unit="px" />
            <Row label="Margem de segurança" value={safetyMarginApplied ? "Sim (cortado)" : "Não (centro literal)"} monospace={false} />
          </Grid>
        </Section>

        {geometryAnalysis && (
          <Section title="Análise Bruta (Host)" icon={<FiInfo size={12} />}>
            <pre className="debug-json">{JSON.stringify(geometryAnalysis, null, 2)}</pre>
          </Section>
        )}
      </div>
    </div>
  );
};

export default BalloonCenteringDebug;
