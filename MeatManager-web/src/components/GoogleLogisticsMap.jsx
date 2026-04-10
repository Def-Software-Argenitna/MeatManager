import React, { useEffect, useRef, useState } from 'react';

const GMAPS_LIBRARIES = ['places'];

const DARK_MAP_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8a8a9a' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2d2d4e' }] },
    { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#6b6b8a' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a3a5c' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#9090b0' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d0d1a' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3a3a5c' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#3a3a5c' }] },
    { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#9090b0' }] },
    { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#c0c0d8' }] },
];

const GMAPS_OPTIONS = {
    styles: DARK_MAP_STYLE,
    disableDefaultUI: false,
    zoomControl: true,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false,
};

const GMAPS_ICON_URLS = {
    pending: 'http://maps.google.com/mapfiles/ms/icons/yellow-dot.png',
    assigned: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png',
    delivered: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png',
};

let googleMapsLoaderPromise = null;

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const loadGoogleMapsApi = (apiKey) => {
    if (!apiKey) {
        return Promise.reject(new Error('Falta la API key de Google Maps.'));
    }

    if (window.google?.maps) {
        return Promise.resolve(window.google.maps);
    }

    if (googleMapsLoaderPromise) {
        return googleMapsLoaderPromise;
    }

    googleMapsLoaderPromise = new Promise((resolve, reject) => {
        const callbackName = '__meatmanagerGoogleMapsReady';
        const existingScript = document.querySelector('script[data-meatmanager-google-maps="true"]');

        window.gm_authFailure = () => {
            reject(new Error('Google Maps rechazó la API key o el dominio configurado.'));
        };

        window[callbackName] = () => {
            resolve(window.google.maps);
            delete window[callbackName];
        };

        if (existingScript) {
            if (window.google?.maps) {
                resolve(window.google.maps);
                delete window[callbackName];
                return;
            }
            existingScript.addEventListener('load', () => {
                if (window.google?.maps) {
                    resolve(window.google.maps);
                } else {
                    reject(new Error('Google Maps no se inicializó correctamente.'));
                }
                delete window[callbackName];
            });
            existingScript.addEventListener('error', () => {
                delete window[callbackName];
                reject(new Error('No se pudo cargar el SDK de Google Maps.'));
            });
            return;
        }

        const script = document.createElement('script');
        script.async = true;
        script.defer = true;
        script.dataset.meatmanagerGoogleMaps = 'true';
        script.src = `https://maps.googleapis.com/maps/api/js?loading=async&key=${encodeURIComponent(apiKey)}&libraries=${GMAPS_LIBRARIES.join(',')}&callback=${callbackName}`;
        script.onerror = () => {
            delete window[callbackName];
            reject(new Error('No se pudo cargar el SDK de Google Maps.'));
        };
        document.head.appendChild(script);
    }).catch((error) => {
        googleMapsLoaderPromise = null;
        throw error;
    });

    return googleMapsLoaderPromise;
};

const getOrderMarkerIcon = (status) => {
    if (status === 'pending') return GMAPS_ICON_URLS.pending;
    if (status === 'delivered') return GMAPS_ICON_URLS.delivered;
    return GMAPS_ICON_URLS.assigned;
};

const buildTruckMarkerIcon = (maps) => ({
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
            <defs>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#111827" flood-opacity="0.35"/>
                </filter>
            </defs>
            <g filter="url(#shadow)">
                <circle cx="24" cy="24" r="20" fill="#f97316" stroke="#ffffff" stroke-width="3"/>
                <path d="M14 18h13c1.1 0 2 .9 2 2v3h4.2c.7 0 1.4.37 1.76.98L38 28v5h-2.2a3.8 3.8 0 0 1-7.4 0H21.6a3.8 3.8 0 0 1-7.4 0H12v-5c0-.55.45-1 1-1h1V19c0-.55.45-1 1-1Zm2 2v7h11v-7Zm14 5v2h5.17l-1.72-2ZM18 34.2a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Zm14 0a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z" fill="#ffffff"/>
            </g>
        </svg>
    `)}`,
    scaledSize: new maps.Size(42, 42),
    anchor: new maps.Point(21, 21),
});

const formatDriverPopup = (driver, formatLastSeen) => `
    <div class="gm-popup-card">
        <strong>Repartidor: ${escapeHtml(driver.repartidor || 'Repartidor')}</strong>
        <span>Ultima sync: ${escapeHtml(formatLastSeen(driver.lastSeenRaw))}</span>
        <span>${escapeHtml(driver.activeOrders ? `${driver.activeOrders} pedido(s) activos` : 'Sin pedidos activos')}</span>
    </div>
`;

const formatOrderPopup = (order) => `
    <div class="gm-popup-card">
        <h4>${escapeHtml(order.customer_name || 'Pedido')}</h4>
        <p>${escapeHtml(order.address || 'Sin dirección')}</p>
        <span>Estado: ${escapeHtml(order.status || 'pending')}</span>
    </div>
`;

const EXPAND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;

const COLLAPSE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="10" y1="14" x2="3" y2="21"></line><line x1="21" y1="3" x2="14" y2="10"></line></svg>`;

const GoogleLogisticsMap = ({
    center,
    zoom,
    drivers,
    orders,
    getOrderCoordinates,
    formatDriverLastSeen,
    onDriverSelect,
    onOrderSelect,
    onExpand,
    className = '',
}) => {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const infoWindowRef = useRef(null);
    const markersRef = useRef([]);
    const pendingInfoWindowRef = useRef(null);
    const expandBtnRef = useRef(null);
    const onExpandRef = useRef(onExpand);
    const onDriverSelectRef = useRef(onDriverSelect);
    const onOrderSelectRef = useRef(onOrderSelect);
    const getOrderCoordinatesRef = useRef(getOrderCoordinates);
    const formatDriverLastSeenRef = useRef(formatDriverLastSeen);
    const [mapError, setMapError] = useState('');
    const [isReady, setIsReady] = useState(false);
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

    useEffect(() => {
        onExpandRef.current = onExpand;
    }, [onExpand]);

    useEffect(() => {
        onDriverSelectRef.current = onDriverSelect;
    }, [onDriverSelect]);

    useEffect(() => {
        onOrderSelectRef.current = onOrderSelect;
    }, [onOrderSelect]);

    useEffect(() => {
        getOrderCoordinatesRef.current = getOrderCoordinates;
    }, [getOrderCoordinates]);

    useEffect(() => {
        formatDriverLastSeenRef.current = formatDriverLastSeen;
    }, [formatDriverLastSeen]);

    useEffect(() => {
        let cancelled = false;

        const boot = async () => {
            try {
                if (mapRef.current) {
                    setIsReady(true);
                    return;
                }
                setMapError('');
                const maps = await loadGoogleMapsApi(apiKey);
                if (cancelled || !containerRef.current) return;

                mapRef.current = new maps.Map(containerRef.current, {
                    center: { lat: center[0], lng: center[1] },
                    zoom,
                    ...GMAPS_OPTIONS,
                });
                infoWindowRef.current = new maps.InfoWindow();

                if (onExpandRef.current) {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.title = 'Expandir mapa';
                    btn.innerHTML = EXPAND_ICON_SVG;
                    btn.style.cssText = [
                        'background:rgba(20,20,20,0.92)',
                        'border:1px solid rgba(255,255,255,0.4)',
                        'border-radius:8px',
                        'width:38px',
                        'height:38px',
                        'display:flex',
                        'align-items:center',
                        'justify-content:center',
                        'cursor:pointer',
                        'margin:8px',
                        'padding:0',
                        'box-shadow:0 2px 10px rgba(0,0,0,0.5)',
                        'backdrop-filter:blur(8px)',
                    ].join(';');
                    btn.addEventListener('mouseenter', () => {
                        btn.style.background = '#f97316';
                        btn.style.borderColor = '#f97316';
                    });
                    btn.addEventListener('mouseleave', () => {
                        btn.style.background = 'rgba(20,20,20,0.92)';
                        btn.style.borderColor = 'rgba(255,255,255,0.4)';
                    });
                    btn.addEventListener('click', () => {
                        if (onExpandRef.current) onExpandRef.current();
                    });
                    expandBtnRef.current = btn;
                    mapRef.current.controls[maps.ControlPosition.TOP_RIGHT].push(btn);
                }

                setIsReady(true);
            } catch (error) {
                if (cancelled) return;
                console.error('[GOOGLE MAPS INIT ERROR]', error);
                setMapError(error instanceof Error ? error.message : 'No se pudo inicializar Google Maps.');
            }
        };

        boot();

        return () => {
            cancelled = true;
        };
    }, [apiKey, center, zoom]);

    useEffect(() => {
        if (!mapRef.current || !window.google?.maps) return;
        mapRef.current.setCenter({ lat: center[0], lng: center[1] });
        mapRef.current.setZoom(zoom);

        if (pendingInfoWindowRef.current) {
            const { marker, content } = pendingInfoWindowRef.current;
            window.setTimeout(() => {
                if (infoWindowRef.current && mapRef.current) {
                    infoWindowRef.current.setContent(content);
                    infoWindowRef.current.open({ map: mapRef.current, anchor: marker });
                }
            }, 120);
        }
    }, [center, zoom]);

    useEffect(() => {
        if (!mapRef.current || !window.google?.maps) return;

        markersRef.current.forEach((marker) => marker.setMap(null));
        markersRef.current = [];

        const maps = window.google.maps;
        const infoWindow = infoWindowRef.current;

        drivers.forEach((driver) => {
            const marker = new maps.Marker({
                map: mapRef.current,
                position: { lat: Number(driver.lat), lng: Number(driver.lng) },
                title: driver.repartidor || 'Repartidor',
                icon: buildTruckMarkerIcon(maps),
            });

            marker.addListener('click', () => {
                const content = formatDriverPopup(driver, formatDriverLastSeenRef.current);
                pendingInfoWindowRef.current = { marker, content };

                if (infoWindow) {
                    infoWindow.setContent(content);
                    infoWindow.open({ map: mapRef.current, anchor: marker });
                }

                if (infoWindow) {
                    infoWindow.setContent(content);
                }

                if (onDriverSelectRef.current) {
                    window.setTimeout(() => onDriverSelectRef.current(driver), 0);
                }
            });

            markersRef.current.push(marker);
        });

        orders.forEach((order) => {
            const coords = getOrderCoordinatesRef.current(order);
            if (!coords) return;

            const marker = new maps.Marker({
                map: mapRef.current,
                position: { lat: coords[0], lng: coords[1] },
                title: order.customer_name || `Pedido #${order.id}`,
                icon: getOrderMarkerIcon(order.status),
            });

            marker.addListener('click', () => {
                const content = formatOrderPopup(order);
                pendingInfoWindowRef.current = { marker, content };

                if (infoWindow) {
                    infoWindow.setContent(content);
                    infoWindow.open({ map: mapRef.current, anchor: marker });
                }
                if (onOrderSelectRef.current) {
                    window.setTimeout(() => onOrderSelectRef.current(order), 0);
                }
            });

            markersRef.current.push(marker);
        });

        return () => {
            markersRef.current.forEach((marker) => marker.setMap(null));
            markersRef.current = [];
        };
    }, [drivers, orders]);

    if (mapError) {
        return (
            <div className="gm-map-fallback">
                <strong>No se pudo cargar Google Maps</strong>
                <span>{mapError}</span>
            </div>
        );
    }

    return (
        <div className={`gm-map-shell ${className}`.trim()}>
            {!isReady && (
                <div className="gm-map-loading">
                    Cargando mapa de Google...
                </div>
            )}
            <div ref={containerRef} className="gm-map-canvas" />
        </div>
    );
};

export default GoogleLogisticsMap;
