import React from 'react';

const BRAND_MAP = {
    cash: { label: '$', bg: '#166534', color: '#ffffff' },
    transfer: { label: 'CBU', bg: '#0f766e', color: '#ffffff' },
    posnet: { label: 'POS', bg: '#7c3aed', color: '#ffffff' },
    crypto: { label: 'CR', bg: '#b45309', color: '#ffffff' },
    visa: { label: 'VISA', bg: '#1a1f71', color: '#ffffff' },
    mastercard: { label: 'MC', bg: '#d9480f', color: '#ffffff' },
    maestro: { label: 'MAE', bg: '#2563eb', color: '#ffffff' },
    cabal: { label: 'CAB', bg: '#15803d', color: '#ffffff' },
    amex: { label: 'AMEX', bg: '#0ea5e9', color: '#ffffff' },
    naranja: { label: 'N', bg: '#f97316', color: '#ffffff' },
    mercado_pago: { label: 'MP', bg: '#00a6ff', color: '#ffffff' },
    uala: { label: 'U', bg: '#06b6d4', color: '#ffffff' },
    cuenta_dni: { label: 'DNI', bg: '#1d4ed8', color: '#ffffff' },
    cuenta_corriente: { label: 'CC', bg: '#c2410c', color: '#ffffff' },
    personal_pay: { label: 'PP', bg: '#111827', color: '#ffffff' },
    modo: { label: 'MODO', bg: '#7c3aed', color: '#ffffff' },
    bitcoin: { label: 'BTC', bg: '#f59e0b', color: '#111827' },
    ethereum: { label: 'ETH', bg: '#475569', color: '#ffffff' },
    usdt: { label: 'USDT', bg: '#059669', color: '#ffffff' },
    dai: { label: 'DAI', bg: '#eab308', color: '#111827' },
};

function getBrandKey(method = {}) {
    const name = (method.name || '').toLowerCase();
    const bank = (method.bank || '').toLowerCase();

    if (name.includes('mercado pago')) return 'mercado_pago';
    if (name.includes('posnet')) return 'posnet';
    if (name.includes('ualá') || name.includes('uala')) return 'uala';
    if (name.includes('cuenta dni')) return 'cuenta_dni';
    if (name.includes('cuenta corriente')) return 'cuenta_corriente';
    if (name.includes('personal pay')) return 'personal_pay';
    if (name.includes('modo')) return 'modo';
    if (name.includes('bitcoin')) return 'bitcoin';
    if (name.includes('ethereum')) return 'ethereum';
    if (name.includes('usdt')) return 'usdt';
    if (name === 'dai') return 'dai';
    if (name.includes('efectivo')) return 'cash';
    if (name.includes('transferencia') || name.includes('cbu') || name.includes('cvu')) return 'transfer';
    if (bank.includes('visa')) return 'visa';
    if (bank.includes('posnet')) return 'posnet';
    if (bank.includes('mastercard')) return 'mastercard';
    if (bank.includes('maestro')) return 'maestro';
    if (bank.includes('cabal')) return 'cabal';
    if (bank.includes('amex')) return 'amex';
    if (bank.includes('naranja') || name.includes('naranja')) return 'naranja';
    if (method.type === 'crypto') return 'crypto';
    if (method.type === 'transfer') return 'transfer';
    if (method.type === 'cuenta_corriente') return 'cuenta_corriente';
    if (method.type === 'card') return 'posnet';
    if (method.type === 'cash') return 'cash';
    return 'cash';
}

const PaymentMethodIcon = ({ method, size = 42, compact = false }) => {
    const key = getBrandKey(method);
    const brand = BRAND_MAP[key] || BRAND_MAP.cash;
    const fontSize = compact ? Math.max(10, Math.round(size * 0.26)) : Math.max(11, Math.round(size * 0.24));

    return (
        <div
            aria-label={method?.name || brand.label}
            title={method?.name || brand.label}
            style={{
                width: size,
                height: size,
                minWidth: size,
                borderRadius: compact ? 10 : 12,
                background: brand.bg,
                color: brand.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize,
                letterSpacing: key === 'mercado_pago' || key === 'cuenta_dni' || key === 'personal_pay' || key === 'modo' ? '0.02em' : '0.04em',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)',
                padding: compact ? '0 4px' : '0 6px',
                textTransform: 'uppercase',
                lineHeight: 1,
            }}
        >
            {brand.label}
        </div>
    );
};

export default PaymentMethodIcon;
