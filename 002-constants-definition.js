// 002-constants-definition.js
const SECURITY_CONFIG = {
    CRITICAL_ACTIONS: [
        'blocked_ip_attempt',
        'ip_rate_limit_exceeded',
        'auto_suspended_fraud',
        'circuit_breaker_opened',
        'emergency_memory_cleanup',
        'job_failed_max_retries',
        'cleanup_rule_failed',
        'job_timeout_max_retries'
    ]
};

const ORDER_STATUS = {
    DRIVER_PENDING: 'Driver Pending',
    ORDER_PLACED: 'Order Placed',
    ORDER_ACCEPTED: 'Order Accepted',
};

module.exports = {
    SECURITY_CONFIG,
    ORDER_STATUS
};