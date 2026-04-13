const ADMIN_ONLY_SETTINGS_KEYS = new Set([
    'ai_enabled',
    'ai_model',
    'branch_transfer_coverage_rules',
    'master_pin',
    'precio_formato',
    'shop_address',
    'shop_name',
    'tg_bot_token',
    'ticket_delete_authorization_code',
    'whatsapp_number',
]);

const isAdminOnlySettingKey = (key) => {
    return ADMIN_ONLY_SETTINGS_KEYS.has(String(key || '').trim().toLowerCase());
};

module.exports = {
    ADMIN_ONLY_SETTINGS_KEYS,
    isAdminOnlySettingKey,
};
