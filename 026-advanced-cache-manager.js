// 026-advanced-cache-manager.js (Original: AdvancedCacheManager.js)
const CacheManager = require('./003-utilities-helpers'); // Assuming CacheManager.js is renamed to 003-utilities-helpers.js and exported from there
const { getDriverNearByData } = require('./003-utilities-helpers'); // For preloadCriticalData (Updated path)

class AdvancedCacheManager extends CacheManager {
    static smartTTL = new Map(); // Can be used for more complex dynamic TTL logic
    static accessPatterns = new Map(); // Map<key, [timestamp1, timestamp2, ...]> for access frequency
    static hitRates = new Map(); // Map<key, {hits: num, total: num}> for cache effectiveness

    static async getWithSmartTTL(key, fallbackFunction, baseMinutes = 5) {
        this.recordAccess(key);

        const cached = await super.get(key); // Call base CacheManager's get method
        if (cached !== null) {
            this.recordHit(key);
            return cached;
        }

        this.recordMiss(key);

        const data = await fallbackFunction(); // Fetch data if not in cache
        const optimizedTTL = this.calculateOptimalTTL(key, baseMinutes);

        await super.set(key, data, optimizedTTL); // Call base CacheManager's set with optimized TTL
        return data;
    }

    static recordAccess(key) {
        if (!this.accessPatterns.has(key)) {
            this.accessPatterns.set(key, []);
        }
        const pattern = this.accessPatterns.get(key);
        pattern.push(Date.now());

        // Keep a rolling window of access times (e.g., last 200 accesses)
        if (pattern.length > 200) {
            pattern.splice(0, pattern.length - 100);
        }
    }

    static recordHit(key) {
        if (!this.hitRates.has(key)) {
            this.hitRates.set(key, { hits: 0, total: 0 });
        }
        const stats = this.hitRates.get(key);
        stats.hits++;
        stats.total++;
    }

    static recordMiss(key) {
        if (!this.hitRates.has(key)) {
            this.hitRates.set(key, { hits: 0, total: 0 });
        }
        this.hitRates.get(key).total++;
    }

    static calculateOptimalTTL(key, baseMinutes) {
        const accessPattern = this.accessPatterns.get(key) || [];
        const hitRate = this.hitRates.get(key);

        if (accessPattern.length < 5) { // Not enough data for smart calculation
            return baseMinutes;
        }

        const now = Date.now();
        const recentAccesses = accessPattern.filter(time => now - time < 60 * 60 * 1000); // Accesses in last hour
        const accessFrequency = recentAccesses.length;

        let multiplier = 1.0;

        // Adjust multiplier based on access frequency
        if (accessFrequency > 50) { multiplier = 3.0; } // Very hot data
        else if (accessFrequency > 20) { multiplier = 2.0; } // Hot data
        else if (accessFrequency < 5) { multiplier = 0.5; }  // Cold data

        // Adjust multiplier based on cache hit rate
        if (hitRate && hitRate.total > 10) { // Enough samples for reliable hit rate
            const hitRatePercent = hitRate.hits / hitRate.total;
            if (hitRatePercent > 0.9) { multiplier *= 1.2; } // Excellent hit rate, can increase TTL
            else if (hitRatePercent < 0.3) { multiplier *= 0.8; } // Poor hit rate, data might be stale or not used from cache
        }

        // Ensure TTL is within reasonable bounds (e.g., min 1 min, max 2 hours)
        const newTTL = Math.max(1, Math.min(120, Math.floor(baseMinutes * multiplier)));
        // console.log(`Calculated optimal TTL for ${key}: ${newTTL} mins`);
        return newTTL;
    }

    static async preloadCriticalData() {
        const criticalKeysMap = {
            'driver_config': { func: getDriverNearByData, defaultTTL: 60 }, // Updated path for utils
            'zone_data_main': { func: async () => ({ zones: ['A', 'B'], count: 10 }), defaultTTL: 30 },
            'security_settings': { func: async () => ({ minPassLength: 8, mfaRequired: true }), defaultTTL: 120 },
            'dispatch_config': { func: async () => ({ maxAttempts: 3, strategy: 'nearest' }), defaultTTL: 60 }
        };

        const preloadPromises = Object.entries(criticalKeysMap).map(async ([key, info]) => {
            try {
                console.log(`AdvancedCacheManager: Preloading critical data for key: ${key}`);
                // Use the super's set method or getWithSmartTTL directly
                await this.getWithSmartTTL(key, info.func, info.defaultTTL);
            } catch (error) {
                console.error(`AdvancedCacheManager: Failed to preload ${key}:`, error);
            }
        });

        await Promise.allSettled(preloadPromises);
        console.log('AdvancedCacheManager: Critical data preloading complete.');
    }

    static getCacheStatistics() {
        const stats = {
            totalKeys: this.cache.size,
            hitRates: {},
            accessPatterns: {},
            memoryUsage: this.estimateMemoryUsage(),
            cacheEntries: {} // Add details of each cached item
        };

        for (const [key, cachedItem] of this.cache) {
            stats.cacheEntries[key] = {
                currentTTL: (cachedItem.ttl / (60 * 1000)).toFixed(1) + ' min',
                age: ((Date.now() - cachedItem.timestamp) / (60 * 1000)).toFixed(1) + ' min',
                remainingTTL: Math.max(0, (cachedItem.ttl - (Date.now() - cachedItem.timestamp)) / (60 * 1000)).toFixed(1) + ' min'
            };
        }


        for (const [key, rates] of this.hitRates) {
            if (rates.total > 0) {
                stats.hitRates[key] = {
                    hitRate: (rates.hits / rates.total * 100).toFixed(2) + '%',
                    totalAccesses: rates.total
                };
            }
        }

        for (const [key, pattern] of this.accessPatterns) {
            const recentAccesses = pattern.filter(time => Date.now() - time < 60 * 60 * 1000);
            stats.accessPatterns[key] = {
                recentAccessCount: recentAccesses.length,
                totalAccessCount: pattern.length
            };
        }

        return stats;
    }

    static estimateMemoryUsage() {
        let totalSize = 0;
        for (const [key, value] of this.cache) {
            try {
                totalSize += JSON.stringify(value).length + key.length;
            } catch (e) {
                console.warn(`Could not estimate size for cache key ${key}: ${e.message}`);
            }
        }
        return `${(totalSize / 1024).toFixed(2)} KB`;
    }
}

module.exports = AdvancedCacheManager;
