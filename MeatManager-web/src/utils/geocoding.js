const COUNTRY_SUFFIX = 'Argentina';
const DEFAULT_REGION_SUFFIX = 'Buenos Aires, Argentina';
const geocodeInFlight = new Map();
const suggestInFlight = new Map();
const GOOGLE_MAPS_API_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();

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

const isArgentinaCountryCode = (value) => String(value || '').trim().toLowerCase() === 'ar';
const hasExplicitRegionHint = (rawAddress) => {
    const normalized = String(rawAddress || '').toLowerCase();
    return /\b(caba|capital federal|buenos aires|provincia|argentina)\b/.test(normalized) || /\b\d{4,8}\b/.test(normalized);
};

const buildScopedAddress = (rawAddress) => {
    const address = normalizeAddressParts(rawAddress);
    if (!address) return '';
    return hasExplicitRegionHint(address)
        ? normalizeAddressParts(address, COUNTRY_SUFFIX)
        : normalizeAddressParts(address, DEFAULT_REGION_SUFFIX);
};

export const getStoredCoordinates = (record) => {
    const latitude = parseCoordinate(record?.latitude ?? record?.lat);
    const longitude = parseCoordinate(record?.longitude ?? record?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
};

export const geocodeAddress = async (rawAddress) => {
    const address = buildScopedAddress(rawAddress);
    if (!address) return null;

    const cacheKey = address.toLowerCase();
    if (geocodeInFlight.has(cacheKey)) {
        return geocodeInFlight.get(cacheKey);
    }

    const request = (async () => {
        if (GOOGLE_MAPS_API_KEY) {
            const params = new URLSearchParams({
                address,
                key: GOOGLE_MAPS_API_KEY,
                region: 'ar',
                language: 'es-AR',
            });

            const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`Geocodificacion Google fallida (${response.status})`);
            }

            const payload = await response.json();
            if (payload.status !== 'OK' || !Array.isArray(payload.results) || payload.results.length === 0) {
                return null;
            }

            const best = payload.results.find((result) =>
                (result.address_components || []).some((component) =>
                    component.types.includes('country') && isArgentinaCountryCode(component.short_name)
                )
            ) || null;
            if (!best) return null;
            const latitude = parseCoordinate(best.geometry?.location?.lat);
            const longitude = parseCoordinate(best.geometry?.location?.lng);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

            return {
                latitude,
                longitude,
                label: best.formatted_address || address,
                query: address,
                source: 'google-geocoding',
                geocoded_at: new Date().toISOString(),
            };
        }

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

        const best = rows.find((row) => isArgentinaCountryCode(row.address?.country_code)) || null;
        if (!best) return null;
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

export const searchAddressSuggestions = async (rawAddress) => {
    const address = buildScopedAddress(rawAddress);
    if (!address || address.length < 5) return [];

    const cacheKey = `suggest:${address.toLowerCase()}`;
    if (suggestInFlight.has(cacheKey)) {
        return suggestInFlight.get(cacheKey);
    }

    const request = (async () => {
        if (GOOGLE_MAPS_API_KEY) {
            const params = new URLSearchParams({
                input: address,
                key: GOOGLE_MAPS_API_KEY,
                language: 'es-AR',
                components: 'country:ar',
                types: 'address',
            });

            const response = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`Sugerencias Google fallidas (${response.status})`);
            }

            const payload = await response.json();
            if (payload.status !== 'OK' && payload.status !== 'ZERO_RESULTS') {
                throw new Error(`Sugerencias Google fallidas (${payload.status})`);
            }

            if (!Array.isArray(payload.predictions) || payload.predictions.length === 0) {
                return [];
            }

            const detailedSuggestions = await Promise.all(
                payload.predictions.slice(0, 5).map(async (prediction) => {
                    const detailParams = new URLSearchParams({
                        place_id: prediction.place_id,
                        key: GOOGLE_MAPS_API_KEY,
                        language: 'es-AR',
                        fields: 'formatted_address,geometry,address_component',
                    });

                    const detailResponse = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${detailParams.toString()}`);
                    if (!detailResponse.ok) return null;

                    const detailPayload = await detailResponse.json();
                    if (detailPayload.status !== 'OK' || !detailPayload.result) return null;

                    const components = detailPayload.result.address_components || [];
                    const countryCode = components.find((component) => component.types.includes('country'))?.short_name || '';
                    if (!isArgentinaCountryCode(countryCode)) return null;
                    const findComponent = (...types) =>
                        components.find((component) => types.every((type) => component.types.includes(type)))?.long_name || '';

                    const streetName = findComponent('route');
                    const streetNumber = findComponent('street_number');
                    const city = findComponent('locality') || findComponent('administrative_area_level_2') || findComponent('sublocality');
                    const zip_code = findComponent('postal_code');

                    return {
                        label: detailPayload.result.formatted_address || prediction.description || address,
                        latitude: parseCoordinate(detailPayload.result.geometry?.location?.lat),
                        longitude: parseCoordinate(detailPayload.result.geometry?.location?.lng),
                        city,
                        zip_code,
                        street: normalizeAddressParts(streetName, streetNumber),
                        raw: detailPayload.result,
                    };
                })
            );

            return detailedSuggestions.filter((row) => row && Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
        }

        const params = new URLSearchParams({
            format: 'jsonv2',
            limit: '5',
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
            throw new Error(`Sugerencias de direccion fallidas (${response.status})`);
        }

        const rows = await response.json();
        if (!Array.isArray(rows)) return [];

        return rows.map((row) => ({
            label: row.display_name || address,
            latitude: parseCoordinate(row.lat),
            longitude: parseCoordinate(row.lon),
            city: row.address?.city || row.address?.town || row.address?.village || '',
            zip_code: row.address?.postcode || '',
            street: normalizeAddressParts(row.address?.road, row.address?.house_number),
            raw: row,
        })).filter((row) =>
            Number.isFinite(row.latitude) &&
            Number.isFinite(row.longitude) &&
            isArgentinaCountryCode(row.raw?.address?.country_code)
        );
    })();

    suggestInFlight.set(cacheKey, request);

    try {
        return await request;
    } finally {
        suggestInFlight.delete(cacheKey);
    }
};
