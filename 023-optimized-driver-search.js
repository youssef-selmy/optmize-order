// 023-optimized-driver-search.js (Original: OptimizedDriverSearch.js)
const { _admin, _firestore } = require('./001-setup-initialization'); // Updated path
const CacheManager = require('./CacheManager'); // Assuming CacheManager.js is renamed to 017-redis-caching-performance.js OR 003-utilities-helpers.js
const { distanceRadius } = require('./003-utilities-helpers'); // Updated path

class OptimizedDriverSearch {
    static spatialIndex = new Map(); // Map<gridKey, List<Driver>>
    static gridSize = 0.01; // Degrees, roughly 1.11 km at equator

    static async getAvailableDriversOptimized(orderId, orderData, dispatchMetadata) {
        const cacheKey = `optimized_drivers_${orderData.vendorID}_${dispatchMetadata.zone_id || 'default'}_${dispatchMetadata.currentRound || '1'}`;
        const cached = await CacheManager.get(cacheKey, 2); // Cache for 2 minutes

        if (cached && cached.length > 0) {
            console.log(`OptimizedDriverSearch: Using cached drivers for order ${orderId}`);
            return cached;
        }

        const drivers = await this.fetchAndIndexDrivers(orderId, orderData, dispatchMetadata);

        let relevantDrivers = drivers; // Default to all if no vendor location
        if (orderData.vendor?.latitude && orderData.vendor?.longitude) {
            relevantDrivers = this.getDriversNearLocation(
                orderData.vendor.latitude,
                orderData.vendor.longitude,
                dispatchMetadata.kDistanceRadiusForDispatchInMiles || 50
            );
        }

        await CacheManager.set(cacheKey, relevantDrivers, 2);
        return relevantDrivers;
    }

    static async fetchAndIndexDrivers(orderId, orderData, dispatchMetadata) {
        const drivers = await getAvailableDrivers(orderId, orderData, dispatchMetadata); // Assuming getAvailableDrivers is imported correctly
        await this.updateSpatialIndex(drivers);
        return drivers;
    }

    static async updateSpatialIndex(drivers) {
        const now = Date.now();
        // Create a *new* temporary index and replace the old one for atomicity and cleaner updates
        const newSpatialIndex = new Map();

        drivers.forEach(driver => {
            if (driver.location?.latitude && driver.location?.longitude) {
                const gridKey = this.getGridKey(driver.location.latitude, driver.location.longitude);

                if (!newSpatialIndex.has(gridKey)) {
                    newSpatialIndex.set(gridKey, []);
                }
                // Only add if driver is active and recently seen online (within 10 minutes)
                if (driver.active && driver.isActive && driver.lastSeenOnline && (now - driver.lastSeenOnline.toMillis()) < (10 * 60 * 1000)) {
                    const gridDrivers = newSpatialIndex.get(gridKey);
                    const existingIndex = gridDrivers.findIndex(d => d.id === driver.id);
                    if (existingIndex >= 0) {
                        gridDrivers[existingIndex] = driver; // Update existing
                    } else {
                        gridDrivers.push(driver); // Add new
                    }
                }
            }
        });
        this.spatialIndex = newSpatialIndex; // Replace the old index
        // The explicit cleanupOldIndexEntries call below ensures any drivers that went offline are truly removed.
        this.cleanupOldIndexEntries();
    }

    static getGridKey(latitude, longitude) {
        // Round down to the nearest grid point for consistent key generation
        const gridLat = Math.floor(latitude / this.gridSize) * this.gridSize;
        const gridLng = Math.floor(longitude / this.gridSize) * this.gridSize;
        return `${gridLat.toFixed(6)}_${gridLng.toFixed(6)}`; // Increased precision for key
    }

    static getDriversNearLocation(latitude, longitude, radiusMiles) {
        const gridKeys = this.getNearbyGridKeys(latitude, longitude, radiusMiles);
        const nearbyDrivers = new Map(); // Use Map to ensure unique drivers

        gridKeys.forEach(key => {
            const gridDrivers = this.spatialIndex.get(key) || [];
            gridDrivers.forEach(driver => {
                // Perform precise distance calculation for drivers within potential grid cells
                const distance = distanceRadius(
                    latitude, longitude,
                    driver.location.latitude, driver.location.longitude
                );

                if (distance <= radiusMiles) {
                    nearbyDrivers.set(driver.id, {
                        ...driver,
                        distance
                    });
                }
            });
        });

        return Array.from(nearbyDrivers.values()).sort((a, b) => a.distance - b.distance);
    }

    static getNearbyGridKeys(latitude, longitude, radiusMiles) {
        const milesPerDegreeLat = 69;
        const milesPerDegreeLon = 69 * Math.cos(latitude * Math.PI / 180);

        const latRangeDegrees = radiusMiles / milesPerDegreeLat;
        const lonRangeDegrees = radiusMiles / milesPerDegreeLon;

        const keys = new Set();

        const startLat = Math.floor((latitude - latRangeDegrees) / this.gridSize) * this.gridSize;
        const endLat = Math.ceil((latitude + latRangeDegrees) / this.gridSize) * this.gridSize;
        const startLng = Math.floor((longitude - lonRangeDegrees) / this.gridSize) * this.gridSize;
        const endLng = Math.ceil((longitude + lonRangeDegrees) / this.gridSize) * this.gridSize;

        // Iterate through all grid cells in the bounding box
        for (let lat = startLat; lat <= endLat; lat += this.gridSize) {
            for (let lng = startLng; lng <= endLng; lng += this.gridSize) {
                keys.add(this.getGridKey(lat, lng));
            }
        }
        return Array.from(keys);
    }

    static cleanupOldIndexEntries() {
        const cutoffTime = Date.now() - (10 * 60 * 1000); // 10 minutes ago

        // Filter drivers within each grid cell
        for (const [key, drivers] of this.spatialIndex) {
            const activeDrivers = drivers.filter(driver => {
                // Ensure driver is truly active and recently seen online
                return driver.active && driver.isActive &&
                       driver.lastSeenOnline && driver.lastSeenOnline.toMillis() > cutoffTime;
            });

            if (activeDrivers.length === 0) {
                this.spatialIndex.delete(key);
            } else {
                this.spatialIndex.set(key, activeDrivers);
            }
        }
        console.log('OptimizedDriverSearch: Cleaned up old index entries.');
    }

    static getSpatialIndexStatistics() {
        let totalDrivers = 0;
        const gridStats = {};

        for (const [key, drivers] of this.spatialIndex) {
            totalDrivers += drivers.length;
            gridStats[key] = drivers.length;
        }

        return {
            totalGrids: this.spatialIndex.size,
            totalDrivers,
            averageDriversPerGrid: totalDrivers / Math.max(this.spatialIndex.size, 1),
            gridStats
        };
    }
}

module.exports = OptimizedDriverSearch;