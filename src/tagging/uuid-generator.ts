/**
 * UUID Generator for Semantic Tags
 * Generates unique identifiers for all semantic tags
 */

// Simple UUID v4 implementation (no external dependencies)
export function generateUUID(): string {
  // Use crypto.getRandomValues if available (browser/Node.js)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buffer = new Uint8Array(16);
    crypto.getRandomValues(buffer);

    // Set version (4) and variant bits
    buffer[6] = (buffer[6] & 0x0f) | 0x40;
    buffer[8] = (buffer[8] & 0x3f) | 0x80;

    const hex = Array.from(buffer)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32)
    ].join('-');
  }

  // Fallback using Math.random()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Generate a short UUID (8 characters) for display purposes
 */
export function generateShortUUID(): string {
  return generateUUID().split('-')[0];
}

/**
 * Validate a UUID format
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Create a namespace-based UUID (deterministic)
 * Useful for creating consistent UUIDs for the same content
 */
export function createNamespacedUUID(namespace: string, name: string): string {
  // Simple hash-based approach for deterministic UUIDs
  const combined = `${namespace}:${name}`;
  let hash = 0;

  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Create a pseudo-UUID from the hash
  const hashStr = Math.abs(hash).toString(16).padStart(8, '0');
  const timestamp = Date.now().toString(16).slice(-12);

  return `${hashStr}-${timestamp.slice(0, 4)}-4${timestamp.slice(4, 7)}-8${timestamp.slice(7, 10)}-${timestamp}0000`.slice(0, 36);
}

/**
 * UUID Registry to track generated UUIDs and prevent collisions
 */
export class UUIDRegistry {
  private registry: Map<string, string> = new Map();

  /**
   * Register a UUID with an associated label
   */
  register(uuid: string, label: string): void {
    this.registry.set(uuid, label);
  }

  /**
   * Check if a UUID is already registered
   */
  exists(uuid: string): boolean {
    return this.registry.has(uuid);
  }

  /**
   * Get the label for a UUID
   */
  getLabel(uuid: string): string | undefined {
    return this.registry.get(uuid);
  }

  /**
   * Generate a unique UUID that doesn't exist in the registry
   */
  generateUnique(): string {
    let uuid = generateUUID();
    let attempts = 0;
    const maxAttempts = 100;

    while (this.exists(uuid) && attempts < maxAttempts) {
      uuid = generateUUID();
      attempts++;
    }

    return uuid;
  }

  /**
   * Clear the registry
   */
  clear(): void {
    this.registry.clear();
  }

  /**
   * Get all registered UUIDs
   */
  getAll(): Map<string, string> {
    return new Map(this.registry);
  }

  /**
   * Export registry to JSON
   */
  toJSON(): Record<string, string> {
    return Object.fromEntries(this.registry);
  }

  /**
   * Import registry from JSON
   */
  fromJSON(data: Record<string, string>): void {
    this.registry = new Map(Object.entries(data));
  }
}

// Global registry instance
export const globalUUIDRegistry = new UUIDRegistry();
