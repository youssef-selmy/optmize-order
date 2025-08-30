// 020-predictive-analytics.js (Original: PredictiveAnalytics.js)
const { _admin, _firestore } = require('./001-setup-initialization'); // Updated path
const { ORDER_STATUS } = require('./002-constants-definition'); // Updated path

class PredictiveAnalytics {
    static async predictOrderDemand(timeframe = '1h', location = null) {
        try {
            const historicalData = await this.getHistoricalOrderData(timeframe, location);
            const prediction = this.calculateDemandPrediction(historicalData);

            await this.storePrediction('order_demand', prediction, timeframe, location);

            return prediction;
        } catch (error) {
            console.error('Demand prediction failed:', error);
            return null;
        }
    }

    static async getHistoricalOrderData(timeframe, location) {
        const timeframes = {
            '1h': 60 * 60 * 1000,
            '4h': 4 * 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000
        };

        const duration = timeframes[timeframe] || timeframes['1h']; // Duration of each time slot
        const now = Date.now();

        // Fetch data for the last 7 days to have enough history perhaps
        let query = _firestore.collection('restaurant_orders')
            .where('createdAt', '>=', _admin.firestore.Timestamp.fromDate(new Date(now - (7 * 24 * 60 * 60 * 1000))));

        if (location) {
            query = query.where('address.location.city', '==', location);
        }

        const snapshot = await query.get();

        const ordersByTimeSlot = {};

        snapshot.docs.forEach(doc => {
            const data = doc.data();
            // Ensure createdAt is a Timestamp object and has toMillis()
            const orderTime = data.createdAt?.toMillis ? data.createdAt.toMillis() : new Date(data.createdAt).getTime(); // Fallback for non-Timestamp createdAt

            // Calculate which time slot this order falls into
            const timeSlot = Math.floor(orderTime / duration) * duration;

            ordersByTimeSlot[timeSlot] = (ordersByTimeSlot[timeSlot] || 0) + 1;
        });

        // Ensure proper sequence and fill gaps with zeros for better linear regression
        // Get min and max timestamps from historical data to know the range
        const orderedTimeSlots = Object.keys(ordersByTimeSlot).map(Number).sort();
        if (orderedTimeSlots.length === 0) {
            // Return empty if no historical data
            return {};
        }

        let minTime = orderedTimeSlots[0];
        let maxTime = orderedTimeSlots[orderedTimeSlots.length - 1];

        const filledOrdersByTimeSlot = {};
        for (let t = minTime; t <= maxTime + duration; t += duration) { // +duration to include the next predicted slot as well sometimes.
            filledOrdersByTimeSlot[t] = ordersByTimeSlot[t] || 0;
        }

        return filledOrdersByTimeSlot;
    }

    static calculateDemandPrediction(historicalData) {
        const timeSlots = Object.keys(historicalData).map(Number).sort();
        const values = timeSlots.map(slot => historicalData[slot]);

        if (values.length < 2) { // Need at least 2 points for a slope, ideally more
            return {
                predicted: values.length > 0 ? values[values.length - 1] : 0,
                confidence: 0.1,
                trend: 'unknown'
            };
        }

        // Simple Linear Regression (Y = mX + c) -> Y: orders count, X: time slot timestamp
        const n = values.length;
        const sumX = timeSlots.reduce((a, b) => a + b, 0);
        const sumY = values.reduce((a, b) => a + b, 0);
        const sumXY = timeSlots.reduce((sum, x, i) => sum + x * values[i], 0);
        const sumXX = timeSlots.reduce((sum, x) => sum + x * x, 0);

        const denominator = (n * sumXX - sumX * sumX);
        let slope, intercept;

        if (denominator === 0) { // All X values are the same (e.g., only one data point type)
            slope = 0;
            intercept = sumY / n; // Average of Y values
        } else {
            slope = (n * sumXY - sumX * sumY) / denominator;
            intercept = (sumY - slope * sumX) / n;
        }

        const lastTimeSlot = timeSlots[timeSlots.length - 1];
        // Dynamic interval calculation for next time slot
        const timeSlotInterval = timeSlots.length > 1 ? timeSlots[1] - timeSlots[0] : (1 * 60 * 60 * 1000); // Default to 1 hour if only one slot definition
        const nextTimeSlot = lastTimeSlot + timeSlotInterval; // Project one interval forward

        const predicted = Math.max(0, Math.round(slope * nextTimeSlot + intercept));

        // Trend based on slope
        const trend = slope > 0.001 ? 'increasing' : slope < -0.001 ? 'decreasing' : 'stable';

        // Very basic confidence: higher spread or constant values mean lower confidence in trend
        // This is a rough estimation, actual confidence requires more statistics (e.g., R-squared)
        const maxVal = Math.max(...values);
        const minVal = Math.min(...values);
        const range = maxVal - minVal;
        let confidence = 0.5; // Base confidence
        if (range > 0) {
            // Adjust confidence based on how much the slope changes relative to data range
            confidence += Math.min(0.4, Math.abs(slope) * timeSlotInterval / range);
        } else if (slope === 0) {
            confidence = 0.8; // High confidence for stable data
        }
        confidence = Math.min(0.95, Math.max(0.1, confidence)); // Clamp confidence

        return {
            predicted,
            confidence: Math.round(confidence * 100) / 100, // Round confidence
            trend,
            slope,
            lastActual: values[values.length - 1],
            nextTimeSlotTimestamp: nextTimeSlot
        };
    }

    static async storePrediction(type, prediction, timeframe, location) {
        await _firestore.collection('predictions').add({
            type,
            prediction,
            timeframe,
            location,
            createdAt: _admin.firestore.FieldValue.serverTimestamp()
        });
    }

    static async predictDriverUtilization() {
        try {
            const onlineDrivers = await this.getOnlineDriversCount();
            const pendingOrders = await this.getPendingOrdersCount();
            const demandPrediction = await this.predictOrderDemand('1h');

            const utilizationPrediction = {
                currentUtilization: onlineDrivers > 0 ? pendingOrders / onlineDrivers : 0,
                predictedDemand: demandPrediction?.predicted || 0,
                recommendedDriverCount: Math.ceil((demandPrediction?.predicted || 0) * 1.2), // 20% buffer
                timestamp: new Date().toISOString()
            };

            await this.storePrediction('driver_utilization', utilizationPrediction, '1h', null);

            return utilizationPrediction;
        } catch (error) {
            console.error('Driver utilization prediction failed:', error);
            return null;
        }
    }

    static async getOnlineDriversCount() {
        const threeMinutesAgo = _admin.firestore.Timestamp.fromDate(
            new Date(Date.now() - 3 * 60 * 60 * 1000)
        );

        const snapshot = await _firestore.collection('users')
            .where('role', '==', 'driver')
            .where('active', '==', true)
            .where('lastSeenOnline', '>=', threeMinutesAgo)
            .get();

        return snapshot.size;
    }

    static async getPendingOrdersCount() {
        const snapshot = await _firestore.collection('restaurant_orders')
            .where('status', 'in', [ORDER_STATUS.ORDER_PLACED, ORDER_STATUS.ORDER_ACCEPTED, ORDER_STATUS.DRIVER_PENDING])
            .get();

        return snapshot.size;
    }
}

module.exports = PredictiveAnalytics;