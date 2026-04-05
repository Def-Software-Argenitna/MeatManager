const COUNTRY_SUFFIX = 'Argentina';
const geocodeInFlight = new Map();

export const normalizeAddressParts = (...parts) =>
    parts
        .flat()
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join(', ');

export const buildClientAddress = (client) =>
    normalizeAddressParts(
        [client?.street, client?.street_number].filter(Boolean).join(' '),
        client?.zip_code,
        client?.city,
        client?.address,
        COUNTRY_SUFFIX
    );

export const buildOrderAddress = (pedido) =>
    normalizeAddressParts(
        pedido?.address,
        pedido?.city,
        pedido?.zip_code,
        COUNTRY_SUFFIX
    );

const parseCoordinate = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

export const getStoredCoordinates = (record) => {
    const latitude = parseCoordinate(record?.latitude ?? record?.lat);
    const longitude = parseCoordinate(record?.longitude ?? record?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
};

export const geocodeAddress = async (rawAddress) => {
    const address = normalizeAddressParts(rawAddress, COUNTRY_SUFFIX);
    if (!address) return null;

    const cacheKey = address.toLowerCase();
    if (geocodeInFlight.has(cacheKey)) {
        return geocodeInFlight.get(cacheKey);
    }

    const request = (async () => {
        const params = new URLSearchParams({
            format: 'jsonv2',
            limit: '1',
            countrycodes: 'ar',
            addressdetails: '1',
            q: address,
        });

        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
            headers: {
                Accept: 'application/json',
                'Accept-Language': 'es-AR,es;q=0.9',
            },
        });

        if (!response.ok) {
            throw new Error(`Geocodificacion fallida (${response.status})`);
        }

        const rows = await response.json();
        if (!Array.isArray(rows) || rows.length === 0) return null;

        const best = rows[0];
        const latitude = parseCoordinate(best.lat);
        const longitude = parseCoordinate(best.lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

        return {
            latitude,
            longitude,
            label: best.display_name || address,
            query: address,
            source: 'nominatim',
            geocoded_at: new Date().toISOString(),
        };
    })();

    geocodeInFlight.set(cacheKey, request);

    try {
        return await request;
    } finally {
        geocodeInFlight.delete(cacheKey);
    }
};
