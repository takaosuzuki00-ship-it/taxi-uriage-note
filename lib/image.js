export const DEFAULT_IMAGE_OPTIONS = {
  maxLongSide: 1000,
  quality: 0.7,
  type: "image/jpeg",
};

function canvasToDataUrl(canvas, type, quality) {
  return canvas.toDataURL(type, quality);
}

export async function compressImageFile(file, options = {}) {
  if (!file) return null;
  const { maxLongSide, quality, type } = { ...DEFAULT_IMAGE_OPTIONS, ...options };
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("画像を読み込めませんでした。"));
      image.src = imageUrl;
    });
    const scale = Math.min(1, maxLongSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvasToDataUrl(canvas, type, quality);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
