// 017-redis-caching-performance.js (Original: CacheManager.js)
// This class does not directly import firebase, it's a generic cache.

// NOTE: This implementation uses an in-memory Map and does NOT interact with Redis.
// The filename is based on your directory tree's intended purpose for this slot.

class CacheManager {
    static cache = new Map();
    static TTL_MINUTES = {
        DRIVER_LIST: 2,
        ZONE_DATA: 30,
        CONFIG: 60,
        VENDOR_DATA: 15
    };

    static async get(key, ttlMinutes = 5) {
        const cached = this.cache.get(key);
        // The check below uses the TTL stored with the item, which is good.
        // The ttlMinutes parameter here is only used for default if not provided during set.
        if (cached && (Date.now() - cached.timestamp) < cached.ttl) { // Using stored TTL in ms
            return cached.data;
        }
        return null;
    }

    static async set(key, data, ttlMinutes = 5) {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl: ttlMinutes * 60 * 1000 // Store TTL in ms for easy comparison
        });
    }

    static async invalidate(pattern) {
        const keys = Array.from(this.cache.keys()).filter(key => key.includes(pattern));
        keys.forEach(key => this.cache.delete(key));
    }

    static async getDriversNearby(lat, lng, radiusMiles) {
        const cacheKey = `drivers_${lat.toFixed(3)}_${lng.toFixed(3)}_${radiusMiles}`;
        return await this.get(cacheKey, this.TTL_MINUTES.DRIVER_LIST);
    }

    static async setDriversNearby(lat, lng, radiusMiles, drivers) {
        const cacheKey = `drivers_${lat.toFixed(3)}_${lng.toFixed(3)}_${radiusMiles}`;
        await this.set(cacheKey, drivers, this.TTL_MINUTES.DRIVER_LIST);
    }
}

module.exports = CacheManager;