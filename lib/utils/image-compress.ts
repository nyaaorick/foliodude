export type ImageCompressOptions = {
  maxWidth?: number;
  maxHeight?: number;
  targetBase64Bytes?: number;
  mimeType?: 'image/jpeg' | 'image/webp';
  initialQuality?: number;
  minQuality?: number;
  maxAttempts?: number;
};

export type ImageCompressResult = {
  base64: string;
  mimeType: string;
  blob: Blob;
  width: number;
  height: number;
  base64Bytes: number;
};

function dataUrlToBase64(dataUrl: string) {
  const [, base64] = dataUrl.split(',');
  return base64 || '';
}

function getBase64Bytes(dataUrl: string) {
  const base64 = dataUrlToBase64(dataUrl);
  const padding = (base64.match(/=*$/)?.[0]?.length ?? 0);
  return Math.floor((base64.length * 3) / 4) - padding;
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (event) => {
      URL.revokeObjectURL(url);
      reject(event);
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to compress image'));
        return;
      }
      resolve(blob);
    }, mimeType, quality);
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function compressImageToBase64(
  file: File,
  options: ImageCompressOptions = {},
): Promise<ImageCompressResult> {
  const maxWidth = options.maxWidth ?? 900;
  const maxHeight = options.maxHeight ?? 900;
  const targetBase64Bytes = options.targetBase64Bytes ?? 200 * 1024;
  const mimeType = options.mimeType ?? 'image/jpeg';
  let quality = options.initialQuality ?? 0.78;
  const minQuality = options.minQuality ?? 0.7;
  const maxAttempts = options.maxAttempts ?? 12;

  const img = await loadImage(file);
  let scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
  let lastResult: ImageCompressResult | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Canvas 2d context is unavailable');
    }
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, mimeType, quality);
    const dataUrl = await blobToDataUrl(blob);
    const base64Bytes = getBase64Bytes(dataUrl);
    lastResult = {
      base64: dataUrlToBase64(dataUrl),
      mimeType,
      blob,
      width,
      height,
      base64Bytes,
    };

    if (base64Bytes <= targetBase64Bytes) {
      return lastResult;
    }

    if (quality > minQuality) {
      quality = Math.max(minQuality, quality - 0.08);
    } else {
      scale *= 0.9;
      quality = Math.min(options.initialQuality ?? 0.78, quality + 0.05);
    }
  }

  if (!lastResult) {
    throw new Error('Unable to compress image');
  }

  return lastResult;
}

export async function compressImageTo200KB(
  file: File,
): Promise<ImageCompressResult> {
  return compressImageToBase64(file, {
    maxWidth: 900,
    maxHeight: 900,
    targetBase64Bytes: 200 * 1024,
    mimeType: 'image/jpeg',
    initialQuality: 0.78,
    minQuality: 0.7,
  });
}
