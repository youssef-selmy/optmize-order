// 021-smart-driver-matching.js (Original: SmartDriverMatching.js)
const { _admin, _firestore } = require('./001-setup-initialization'); // Updated path
const CacheManager = require('./CacheManager'); // Assuming CacheManager.js is renamed to 017-redis-caching-performance.js OR 003-utilities-helpers.js
const { distanceRadius } = require('./003-utilities-helpers'); // Updated path

class SmartDriverMatching {
    static async findOptimalDriver(orderData, availableDrivers, contextData = {}) {
        const scoredDrivers = await Promise.all(
            availableDrivers.map(async (driver) => {
                const score = await this.calculateDriverScore(driver, orderData, contextData);
                return { ...driver, matchScore: score };
            })
        );

        return scoredDrivers.sort((a, b) => b.matchScore - a.matchScore);
    }

    static async calculateDriverScore(driver, orderData, contextData) {
        let score = 100; // Base score

        // Apply weights and combine scores
        const distanceScore = this.calculateDistanceScore(driver, orderData);
        score = (score * 0.70) + (distanceScore * 0.30); // 30% importance for distance

        const performanceScore = await this.calculatePerformanceScore(driver);
        score = (score * 0.75) + (performanceScore * 0.25); // 25% importance for performance

        const availabilityScore = this.calculateAvailabilityScore(driver, orderData);
        score = (score * 0.80) + (availabilityScore * 0.20); // 20% importance for availability

        const preferenceScore = await this.calculatePreferenceScore(driver, orderData);
        score = (score * 0.85) + (preferenceScore * 0.15); // 15% importance for preferences

        const realtimeScore = await this.calculateRealtimeScore(driver, contextData);
        score = (score * 0.90) + (realtimeScore * 0.10); // 10% importance for realtime factors

        return Math.round(score * 100) / 100; // Round to 2 decimal places
    }

    static calculateDistanceScore(driver, orderData) {
        // Ensure necessary data for calculation
        // driver.location: {latitude, longitude}, orderData.vendor: {latitude, longitude}
        if (!driver.location || !orderData.vendor?.latitude || !orderData.vendor?.longitude) return 50; // Neutral score if data is missing

        const maxPreferredDistance = 5; // miles
        const distanceMiles = distanceRadius(
            driver.location.latitude, driver.location.longitude,
            orderData.vendor.latitude, orderData.vendor.longitude
        );

        if (distanceMiles <= maxPreferredDistance) {
            return 100; // Optimal distance
        }

        // Score decreases linearly after maxPreferredDistance
        // For every mile past preferred, reduce score by 10 points
        const score = Math.max(0, 100 - ((distanceMiles - maxPreferredDistance) * 10));
        return score;
    }

    static async calculatePerformanceScore(driver) {
        try {
            const last30Days = Date.now() - (30 * 24 * 60 * 60 * 1000);

            const performanceSnapshot = await _firestore.collection('driver_performance')
                .where('driverId', '==', driver.id)
                .where('timestamp', '>=', _admin.firestore.Timestamp.fromDate(new Date(last30Days)))
                .get();

            if (performanceSnapshot.empty) {
                return 75; // Neutral score for drivers with no recent data
            }

            let totalDeliveries = 0;
            let successfulDeliveries = 0;
            let totalRating = 0;
            let ratingCount = 0;
            let totalDeliveryTime = 0; // Sum of delivery times in minutes
            let deliveryTimeCount = 0;

            performanceSnapshot.docs.forEach(doc => {
                const data = doc.data();
                totalDeliveries++;

                if (data.successful) successfulDeliveries++;
                if (data.rating) {
                    totalRating += data.rating;
                    ratingCount++;
                }
                if (data.deliveryTime) { // Assuming deliveryTime is in minutes
                    totalDeliveryTime += data.deliveryTime;
                    deliveryTimeCount++;
                }
            });

            const successRate = (totalDeliveries > 0 ? (successfulDeliveries / totalDeliveries) : 1) * 100;
            const avgRating = ratingCount > 0 ? totalRating / ratingCount : 4.5; // Default if no ratings
            const avgTime = deliveryTimeCount > 0 ? totalDeliveryTime / deliveryTimeCount : 30; // Default if no delivery times (in minutes)

            let score = 0;
            // Success rate (40% weight)
            score += Math.min(successRate, 100) * 0.4;

            // Average Rating (30% weight)
            score += (avgRating / 5) * 100 * 0.3;

            // Average Delivery Time (30% weight) - lower is better
            // Optimal target: 20 minutes. Penalize 2 points for every min over 20.
            score += Math.max(0, 100 - ((avgTime - 20) * 2)) * 0.3;

            return Math.max(0, Math.min(100, score)); // Ensure score is between 0 and 100
        } catch (error) {
            console.error("Error calculating performance score:", error);
            return 75; // Fallback score
        }
    }

    static calculateAvailabilityScore(driver, orderData) {
        let score = 100;

        // Penalty for having multiple active orders
        const currentOrders = driver.orderRequestData?.length || 0;
        if (currentOrders > 0) {
            score -= Math.min(currentOrders * 30, 100); // Heavy penalty for active tasks
        }

        // Must be active/online to be considered
        if (!driver.active || !driver.isActive) {
            return 0; // Driver is not available
        }

        // Recency of last_seen_online status
        if (driver.lastSeenOnline) {
            // Assume lastSeenOnline is a Firestore Timestamp
            const minutesSinceLastSeen = (Date.now() - driver.lastSeenOnline.toMillis()) / (60 * 1000);
            if (minutesSinceLastSeen > 5) { // Penalize if last update was over 5 minutes ago
                score -= Math.min((minutesSinceLastSeen - 5) * 5, score); // 5 points per min over 5 mins
            }
        }

        return Math.max(0, score);
    }

    static async calculatePreferenceScore(driver, orderData) {
        try {
            // Customer's preferred or blocked drivers (if customer preferences are stored)
            const customerPrefs = await CacheManager.get(`customer_prefs_${orderData.author?.uid}`, 60); // Assuming CacheManager.js is renamed correctly

            if (customerPrefs) {
                if (customerPrefs.preferredDrivers?.includes(driver.id)) {
                    return 100; // Strong positive if customer prefers this driver
                }
                if (customerPrefs.blockedDrivers?.includes(driver.id)) {
                    return 0; // Strong negative if customer blocked this driver
                }
            }

            // Driver's preferred vendors
            if (driver.preferredVendors?.includes(orderData.vendorID)) {
                return 90; // Driver prefers delivering from this vendor
            }
            // Add other driver preferences here (e.g., vehicle type, delivery zone etc.)

            return 80; // Default for no specific preference match/mismatch
        } catch (error) {
            console.error("Error calculating preference score:", error);
            return 80; // Fallback score
        }
    }

    static async calculateRealtimeScore(driver, contextData) {
        let score = 100;

        // Weather conditions impact
        if (contextData.weather?.condition === 'rain' || contextData.weather?.condition === 'snow') {
            score -= 10;
        }

        // Traffic conditions
        if (contextData.traffic?.level === 'heavy') {
            score -= 15;
        }

        // Time of day (e.g., peak hours are often more challenging but indicate higher demand)
        const hour = new Date().getHours();
        if ((hour >= 11 && hour <= 14) || (hour >= 17 && hour <= 21)) { // Lunch and Dinner rush
            score += 10; // Drivers active and efficient during rush hours get a bonus
        }

        return Math.max(0, score);
    }
}

module.exports = SmartDriverMatching;