/**
 * Código QR generado en el navegador (qrcode-generator, MIT). Se pinta como un único <path> SVG, nítido a
 * cualquier tamaño (proyector o móvil) y sin peticiones a servicios externos.
 */
import qrcode from 'qrcode-generator';

export type QrMatrix = { size: number; dark: (row: number, col: number) => boolean };

/** Matriz del QR con corrección de errores «M» (≈15 %): aguanta reflejos del proyector sin crecer demasiado. */
export function qrMatrix(text: string): QrMatrix {
  const code = qrcode(0, 'M');
  code.addData(text, 'Byte');
  code.make();
  return { size: code.getModuleCount(), dark: (row, col) => code.isDark(row, col) };
}

/** Trazado SVG de los módulos oscuros (un rectángulo por tramo horizontal), desplazado por el margen. */
export function qrPath(matrix: QrMatrix, margin = 4): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row++) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.dark(row, col)) { col++; continue; }
      const start = col;
      while (col < matrix.size && matrix.dark(row, col)) col++;
      parts.push(`M${start + margin} ${row + margin}h${col - start}v1h-${col - start}z`);
    }
  }
  return parts.join('');
}
