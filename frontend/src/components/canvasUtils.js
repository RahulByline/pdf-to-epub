/**
 * Canvas Editor Utilities
 * Helper functions for canvas operations, hit detection, and object manipulation
 */

/**
 * Generate unique ID for canvas objects
 */
export const generateObjectId = () => {
  return `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Convert screen coordinates to canvas coordinates
 */
export const screenToCanvas = (screenX, screenY, canvas, zoom = 1) => {
  if (!canvas) return { x: 0, y: 0 };

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (screenX - rect.left) * scaleX / zoom,
    y: (screenY - rect.top) * scaleY / zoom
  };
};

/**
 * Convert canvas coordinates to screen coordinates
 */
export const canvasToScreen = (canvasX, canvasY, canvas, zoom = 1) => {
  if (!canvas) return { x: 0, y: 0 };

  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;

  return {
    x: rect.left + (canvasX * scaleX * zoom),
    y: rect.top + (canvasY * scaleY * zoom)
  };
};

/**
 * Check if a point is inside a rectangle (with optional rotation)
 */
export const pointInRect = (x, y, rect, rotation = 0) => {
  if (rotation === 0) {
    return x >= rect.x && x <= rect.x + rect.width &&
           y >= rect.y && y <= rect.y + rect.height;
  }

  // Handle rotated rectangles
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  // Rotate point around rectangle center
  const cos = Math.cos(-rotation * Math.PI / 180);
  const sin = Math.sin(-rotation * Math.PI / 180);

  const translatedX = x - centerX;
  const translatedY = y - centerY;

  const rotatedX = translatedX * cos - translatedY * sin;
  const rotatedY = translatedX * sin + translatedY * cos;

  return rotatedX >= -rect.width/2 && rotatedX <= rect.width/2 &&
         rotatedY >= -rect.height/2 && rotatedY <= rect.height/2;
};

/**
 * Get the bounding rectangle of a rotated rectangle
 */
export const getBoundingRect = (rect, rotation = 0) => {
  if (rotation === 0) {
    return { ...rect };
  }

  const corners = [
    rotatePoint(rect.x, rect.y, rect.x + rect.width/2, rect.y + rect.height/2, rotation),
    rotatePoint(rect.x + rect.width, rect.y, rect.x + rect.width/2, rect.y + rect.height/2, rotation),
    rotatePoint(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width/2, rect.y + rect.height/2, rotation),
    rotatePoint(rect.x, rect.y + rect.height, rect.x + rect.width/2, rect.y + rect.height/2, rotation)
  ];

  const minX = Math.min(...corners.map(c => c.x));
  const minY = Math.min(...corners.map(c => c.y));
  const maxX = Math.max(...corners.map(c => c.x));
  const maxY = Math.max(...corners.map(c => c.y));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
};

/**
 * Rotate a point around a center point
 */
export const rotatePoint = (x, y, centerX, centerY, angleDegrees) => {
  const angle = angleDegrees * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const translatedX = x - centerX;
  const translatedY = y - centerY;

  const rotatedX = translatedX * cos - translatedY * sin;
  const rotatedY = translatedX * sin + translatedY * cos;

  return {
    x: rotatedX + centerX,
    y: rotatedY + centerY
  };
};

/**
 * Check if two rectangles intersect
 */
export const rectsIntersect = (rect1, rect2) => {
  return !(rect1.x + rect1.width < rect2.x ||
           rect2.x + rect2.width < rect1.x ||
           rect1.y + rect1.height < rect2.y ||
           rect2.y + rect2.height < rect1.y);
};

/**
 * Get distance between two points
 */
export const distance = (x1, y1, x2, y2) => {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
};

/**
 * Clamp a value between min and max
 */
export const clamp = (value, min, max) => {
  return Math.min(Math.max(value, min), max);
};

/**
 * Snap to grid (optional utility)
 */
export const snapToGrid = (value, gridSize = 10) => {
  return Math.round(value / gridSize) * gridSize;
};

/**
 * Create a text object
 */
export const createTextObject = (x, y, width = 200, height = 50, content = 'Text Block') => {
  return {
    id: generateObjectId(),
    type: 'text',
    x,
    y,
    width,
    height,
    content,
    fontSize: 16,
    fontFamily: 'Arial',
    color: '#000000',
    rotation: 0
  };
};

/**
 * Create an image object
 */
export const createImageObject = (x, y, width = 200, height = 150, imageSrc = null) => {
  return {
    id: generateObjectId(),
    type: 'image',
    x,
    y,
    width,
    height,
    imageSrc,
    rotation: 0
  };
};

/**
 * Create a placeholder object
 */
export const createPlaceholderObject = (x, y, width = 200, height = 100, placeholderType = 'text') => {
  return {
    id: generateObjectId(),
    type: 'placeholder',
    placeholderType, // 'text', 'image', 'audio'
    x,
    y,
    width,
    height,
    rotation: 0
  };
};

/**
 * Load image from URL or file
 */
export const loadImage = (src) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
};

/**
 * Convert file to data URL
 */
export const fileToDataURL = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Get text dimensions (approximate)
 */
export const getTextDimensions = (text, fontSize = 16, fontFamily = 'Arial') => {
  // Create temporary canvas for measurement
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px ${fontFamily}`;

  const metrics = ctx.measureText(text);
  const lines = text.split('\n');
  const lineHeight = fontSize * 1.2; // Approximate line height

  return {
    width: metrics.width,
    height: lines.length * lineHeight
  };
};

/**
 * Wrap text to fit within width
 */
export const wrapText = (text, maxWidth, fontSize = 16, fontFamily = 'Arial') => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px ${fontFamily}`;

  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine + (currentLine ? ' ' : '') + word;
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
};

/**
 * Export canvas to image
 */
export const exportCanvasToImage = (canvas, format = 'png', quality = 1.0) => {
  return canvas.toDataURL(`image/${format}`, quality);
};

/**
 * Import objects from JSON
 */
export const importObjectsFromJSON = (jsonString) => {
  try {
    const objects = JSON.parse(jsonString);

    // Validate and assign IDs if missing
    return objects.map(obj => ({
      ...obj,
      id: obj.id || generateObjectId()
    }));
  } catch (error) {
    console.error('Failed to import objects:', error);
    return [];
  }
};

/**
 * Export objects to JSON
 */
export const exportObjectsToJSON = (objects) => {
  return JSON.stringify(objects, null, 2);
};

/**
 * Deep clone objects array
 */
export const cloneObjects = (objects) => {
  return objects.map(obj => ({
    ...obj,
    // Deep clone nested objects if any
    ...(obj.image && { image: obj.image }),
    ...(obj.content && { content: obj.content })
  }));
};

/**
 * Find object by ID
 */
export const findObjectById = (objects, id) => {
  return objects.find(obj => obj.id === id);
};

/**
 * Get objects at position (for stacking/selection)
 */
export const getObjectsAtPosition = (objects, x, y) => {
  return objects.filter(obj => pointInRect(x, y, obj, obj.rotation || 0));
};

/**
 * Calculate center point of object
 */
export const getObjectCenter = (obj) => {
  return {
    x: obj.x + obj.width / 2,
    y: obj.y + obj.height / 2
  };
};

/**
 * Move object to center of canvas
 */
export const centerObject = (obj, canvasWidth, canvasHeight) => {
  return {
    ...obj,
    x: (canvasWidth - obj.width) / 2,
    y: (canvasHeight - obj.height) / 2
  };
};