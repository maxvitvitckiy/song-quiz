// Libraries the pages load from a CDN with a <script> tag.

/** qrcode-generator 1.4.4 (index.html), draws the join link's QR code. */
declare function qrcode(typeNumber: number, errorCorrectionLevel: "L" | "M" | "Q" | "H"): {
  addData(data: string): void;
  make(): void;
  createSvgTag(options?: { cellSize?: number; margin?: number; scalable?: boolean }): string;
  createImgTag(cellSize?: number, margin?: number): string;
};
