import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import { useLicense } from '../context/LicenseContext';
import './DashboardLayout.css';

const BlockedScreen = ({ installationId, machineId, supportNumber }) => (
    <div style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: '#0a0a0a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: '1.5rem', padding: '2rem',
        fontFamily: 'system-ui, sans-serif', color: '#fff',
        textAlign: 'center',
    }}>
        <div style={{ fontSize: '4rem' }}>🔒</div>
        <h1 style={{ fontSize: '1.8rem', fontWeight: '800', color: '#ef4444', margin: 0 }}>
            Licencia no autorizada en este equipo
        </h1>
        <p style={{ color: '#9ca3af', maxWidth: '480px', lineHeight: 1.6, margin: 0 }}>
            Esta licencia esta activada en otra PC. Cada instalacion requiere su propia licencia.
            Contacta con soporte para obtener una licencia para este equipo.
        </p>
        <div style={{
            background: '#1a1a1a', border: '1px solid #333',
            borderRadius: '8px', padding: '1rem 1.5rem',
            display: 'flex', flexDirection: 'column', gap: '0.5rem',
            fontSize: '0.82rem', color: '#6b7280',
        }}>
            <span>ID de instalacion: <strong style={{ color: '#d1d5db' }}>{installationId}</strong></span>
            {machineId && <span>ID de equipo: <strong style={{ color: '#d1d5db' }}>{machineId}</strong></span>}
        </div>
        <a
            href={`https://wa.me/${supportNumber}?text=Necesito%20una%20nueva%20licencia.%20Mi%20ID%20de%20instalacion%20es%20${installationId}%20y%20mi%20ID%20de%20equipo%20es%20${machineId}`}
            target="_blank" rel="noreferrer"
            style={{
                background: '#22c55e', color: '#fff', textDecoration: 'none',
                padding: '0.75rem 1.5rem', borderRadius: '8px',
                fontWeight: '700', fontSize: '0.9rem',
            }}
        >
            📲 Contactar soporte por WhatsApp
        </a>
    </div>
);

const DashboardLayout = () => {
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const location = useLocation();
    const prefersReducedMotion = useReducedMotion();
    const routeShellRef = useRef(null);
    const { isBlocked, installationId, machineId, supportNumber } = useLicense();

    const toggleSidebar = () => {
        setIsSidebarCollapsed(!isSidebarCollapsed);
    };

    const routeMotion = useMemo(() => {
        const directions = [
            { x: -56, y: 0, rotateX: 0.8, rotateY: -2.4 },
            { x: 56, y: 0, rotateX: 0.8, rotateY: 2.4 },
            { x: 0, y: -44, rotateX: -2.8, rotateY: 0 },
            { x: 0, y: 44, rotateX: 2.8, rotateY: 0 },
        ];
        const seed = location.pathname.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return directions[seed % directions.length];
    }, [location.pathname]);

    const pageTransition = prefersReducedMotion
        ? {
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            exit: { opacity: 0 },
        }
        : {
            initial: {
                opacity: 0,
                x: routeMotion.x * 0.2,
                y: routeMotion.y * 0.2,
                scale: 0.996,
                filter: 'blur(3px)',
            },
            animate: {
                opacity: 1,
                x: 0,
                y: 0,
                scale: 1,
                filter: 'blur(0px)',
                transition: {
                    duration: 0.3,
                    ease: [0.22, 1, 0.36, 1],
                },
            },
            exit: {
                opacity: 0,
                scale: 0.998,
                filter: 'blur(2px)',
                transition: {
                    duration: 0.12,
                    ease: 'easeInOut',
                },
            },
        };

    useEffect(() => {
        if (prefersReducedMotion) return undefined;

        const root = routeShellRef.current;
        if (!root) return undefined;

        const candidates = root.querySelectorAll(`
            .dashboard-stat-card,
            .dashboard-panel,
            .dashboard-mini-metric,
            .dashboard-quick-action,
            .pos-products-area,
            .pos-ticket,
            .product-card,
            .ticket-item,
            .ticket-footer,
            .action-buttons,
            .products-grid,
            .dashboard-main-grid,
            .dashboard-stats-grid,
            .neo-card,
            .card,
            .panel,
            .page-header,
            .top-bar,
            .sidebar,
            .user-profile,
            .user-info,
            .status-indicator-mini,
            table,
            form,
            section,
            article,
            aside,
            [class*="card"],
            [class*="panel"],
            [class*="widget"],
            [class*="grid-item"],
            [class*="table-container"],
            [class*="chart"],
            [class*="summary"],
            [class*="stats"]
        `);

        const animated = [];
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        candidates.forEach((element, index) => {
            if (!(element instanceof HTMLElement)) return;
            if (element.closest('[data-mm-animated-parent]')) return;

            const rect = element.getBoundingClientRect();
            if (rect.width < 36 || rect.height < 24) return;

            const centerX = rect.left + (rect.width / 2);
            const centerY = rect.top + (rect.height / 2);
            const distances = [
                { axis: 'x', value: -1, distance: centerX },
                { axis: 'x', value: 1, distance: viewportWidth - centerX },
                { axis: 'y', value: -1, distance: centerY },
                { axis: 'y', value: 1, distance: viewportHeight - centerY },
            ];

            distances.sort((a, b) => a.distance - b.distance);
            const nearest = distances[0];

            const offsetX = nearest.axis === 'x' ? nearest.value * Math.min(72, Math.max(28, rect.width * 0.18)) : 0;
            const offsetY = nearest.axis === 'y' ? nearest.value * Math.min(58, Math.max(22, rect.height * 0.22)) : 0;
            const delay = Math.min(index * 0.028, 0.38);

            element.style.setProperty('--mm-enter-x', `${offsetX}px`);
            element.style.setProperty('--mm-enter-y', `${offsetY}px`);
            element.style.setProperty('--mm-enter-delay', `${delay}s`);
            element.setAttribute('data-mm-animated', 'true');
            animated.push(element);
        });

        const raf = window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                animated.forEach((element) => {
                    element.setAttribute('data-mm-entered', 'true');
                });
            });
        });

        return () => {
            window.cancelAnimationFrame(raf);
        };
    }, [location.pathname, prefersReducedMotion]);

    if (isBlocked) {
        return <BlockedScreen installationId={installationId} machineId={machineId} supportNumber={supportNumber} />;
    }

    return (
        <div className="layout-wrapper">
            <TopBar onToggleSidebar={toggleSidebar} isSidebarCollapsed={isSidebarCollapsed} />
            <div className={`dashboard-layout ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
                <Sidebar isCollapsed={isSidebarCollapsed} />
                <main className="main-content">
                    <div className="route-stage">
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                                key={location.pathname}
                                ref={routeShellRef}
                                className="route-shell"
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                variants={pageTransition}
                            >
                                <Outlet />
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </main>
            </div>
        </div>
    );
};

export default DashboardLayout;
