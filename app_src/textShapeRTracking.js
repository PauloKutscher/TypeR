const roundedDimension = (value) => Math.round(Number(value) || 0);

// Bubble detection is deliberately stable across translations. Moving a text
// layer does not change the bubble silhouette, and users can explicitly
// refresh after moving text to another bubble. Resizing still invalidates the
// cache because it changes TextShapeR's pixel calibration.
// O identificador do documento entra na chave porque os IDs de camada
// recomeçam a cada página: sem ele, a camada 5 da página aberta agora lê o
// balão que a camada 5 da página anterior deixou no cache.
const getBubbleCacheKey = (documentId, layerId, bounds, fallbackKey) => {
  const document = documentId == null ? "?" : documentId;
  if (layerId == null) return `bubble:${document}:${fallbackKey}`;
  if (!bounds) return `bubble:${document}:${layerId}`;
  return `bubble:${document}:${layerId}:${roundedDimension(bounds.width)},${roundedDimension(bounds.height)}`;
};

const haveSameLayerSize = (first, second) =>
  !!first &&
  !!second &&
  roundedDimension(first.width) === roundedDimension(second.width) &&
  roundedDimension(first.height) === roundedDimension(second.height);

/*
 * Balões duplos e triplos põem duas ou três camadas de texto dentro do mesmo
 * contorno. A chave acima segue a camada, então cada uma paga o seu próprio
 * wand scan: na página de referência, 4 dos 9 scans repetiam um balão que já
 * tinha sido traçado, a 340 ms cada.
 *
 * A caixa envolvente do balão não decide sozinha — balões vizinhos se
 * sobrepõem em caixa com facilidade, e servir o contorno errado moldaria o
 * texto na forma do vizinho. O teste é contra o perfil amostrado, que já está
 * no cache: os quatro cantos da caixa de tinta têm de cair dentro dele. Errar
 * para o lado caro (não reconhecer o balão e escanear de novo) é de graça;
 * errar para o lado barato entrega uma forma errada.
 */
const profileContainsPoint = (profile, x, y) => {
  const bounds = profile && profile.bounds;
  const rows = profile && profile.rows;
  if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return false;
  if (!Array.isArray(rows) || rows.length < 2) return false;
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return false;
  const u = (x - bounds.left) / bounds.width;
  const v = (y - bounds.top) / bounds.height;
  // As linhas amostram o contorno em faixas. Interpola entre as duas vizinhas
  // em vez de arredondar para a mais próxima: num balão que afila, a linha
  // mais próxima é larga demais justo na borda onde a decisão importa.
  let lower = rows[0];
  let upper = rows[rows.length - 1];
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].y <= v) lower = rows[index];
    if (rows[index].y >= v) {
      upper = rows[index];
      break;
    }
  }
  const span = upper.y - lower.y;
  const ratio = span > 0 ? (v - lower.y) / span : 0;
  const left = lower.left + (upper.left - lower.left) * ratio;
  const right = lower.right + (upper.right - lower.right) * ratio;
  return u >= left && u <= right;
};

/*
 * O contorno traçado não descreve só o balão: antes de amostrar, a detecção
 * fecha os buracos das letras crescendo e encolhendo a seleção por metade do
 * corpo da fonte. Duas camadas do mesmo balão com o mesmo corpo devolvem o
 * mesmo contorno bit a bit (medido nas camadas 25, 21 e 19 da página de
 * referência); uma camada de corpo 16 no balão das de corpo 17 devolveu um
 * contorno até 0,15 mais estreito, o que naquele balão são 142 px. Por isso o
 * reuso exige corpo igual: economizar um scan não vale entregar outra forma.
 */
const findEnclosingBubbleShape = (cache, bounds, textSize, documentId) => {
  if (!cache || !bounds) return null;
  if (!(bounds.width > 0) || !(bounds.height > 0)) return null;
  if (!(Number(textSize) > 0)) return null;
  if (documentId == null) return null;
  const corners = [
    [bounds.left, bounds.top],
    [bounds.right, bounds.top],
    [bounds.left, bounds.bottom],
    [bounds.right, bounds.bottom],
  ];
  for (const shape of cache.values()) {
    // Só um balão detectado serve: uma falha em cache (null) ou uma forma vinda
    // de seleção manual não diz nada sobre onde esta camada está
    if (!shape || shape.source !== "bubble" || !shape.profile) continue;
    // O teste dos quatro cantos é em coordenadas absolutas da página. Duas
    // páginas do mesmo volume põem balões em coordenadas parecidas e usam o
    // mesmo corpo de fonte, então sem esta linha uma camada da página aberta
    // agora cabe dentro de um balão traçado noutra e recebe o contorno errado.
    if (shape.documentId !== documentId) continue;
    if (Number(shape.textSize) !== Number(textSize)) continue;
    let inside = true;
    for (let index = 0; index < corners.length; index += 1) {
      if (!profileContainsPoint(shape.profile, corners[index][0], corners[index][1])) {
        inside = false;
        break;
      }
    }
    if (inside) return shape;
  }
  return null;
};

export { getBubbleCacheKey, haveSameLayerSize, findEnclosingBubbleShape, profileContainsPoint };
