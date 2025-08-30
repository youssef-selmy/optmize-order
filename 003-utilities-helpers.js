// 003-utilities-helpers.js

// --- For utils.js content ---
// Import Firebase SDK components for Timestamp (required by some utils)
const { _admin, _firestore } = require('./001-setup-initialization'); // Updated path

// Mock geospatial distance calculation (Haversine formula approximation)
function distanceRadius(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Radius of Earth in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in miles
    return d;
}

// Mock function for getting available drivers (in a real app, this would query Firestore/DB)
async function getAvailableDrivers(orderId, orderData, dispatchMetadata) {
    console.log(`MOCK: Getting available drivers for order ${orderId}`);
    // Simulate fetching drivers from a database or service
    const mockDrivers = [
        { id: 'driver1', location: { latitude: 34.052235, longitude: -118.243683 }, active: true, isActive: true, lastSeenOnline: _admin.firestore.Timestamp.fromDate(new Date()), orderRequestData: [], preferredVendors: ['vendorA'] },
        { id: 'driver2', location: { latitude: 34.05, longitude: -118.25 }, active: true, isActive: true, lastSeenOnline: _admin.firestore.Timestamp.fromDate(new Date()), orderRequestData: [{ orderId: orderId, type: 'pickup' }], preferredVendors: ['vendorB'] },
        { id: 'driver3', location: { latitude: 34.055, longitude: -118.26 }, active: true, isActive: true, lastSeenOnline: _admin.firestore.Timestamp.fromDate(new Date()), orderRequestData: [], preferredVendors: [] },
    ];
    return mockDrivers;
}

// Mock function for getting driver nearby data (for preloading cache)
async function getDriverNearByData() {
    console.log("MOCK: Fetching driver nearby data for preloading.");
    return {
        driverCount: 1500,
        averageDistance: 1.5,
        zones: [{ id: 'zone1', count: 50 }, { id: 'zone2', count: 100 }]
    };
}

// --- CacheManager.js content ---
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
        // NOTE: The ttlMinutes parameter here is not used for re-validation against stored ttl
        // The check below uses the TTL stored with the item, which is good.
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

module.exports = {
    distanceRadius,
    getAvailableDrivers,
    getDriverNearByData,
    CacheManager // Exporting the CacheManager class as well, assuming it's a utility used elsewhere
};
