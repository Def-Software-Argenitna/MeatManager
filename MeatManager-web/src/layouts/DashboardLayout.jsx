import React, { useMemo, useState } from 'react';
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
                x: routeMotion.x,
                y: routeMotion.y,
                scale: 0.985,
                filter: 'blur(10px)',
                rotateX: routeMotion.rotateX,
                rotateY: routeMotion.rotateY,
                transformPerspective: 1400,
            },
            animate: {
                opacity: 1,
                x: 0,
                y: 0,
                scale: 1,
                filter: 'blur(0px)',
                rotateX: 0,
                rotateY: 0,
                transformPerspective: 1400,
                transition: {
                    duration: 0.52,
                    ease: [0.22, 1, 0.36, 1],
                },
            },
            exit: {
                opacity: 0,
                scale: 0.992,
                filter: 'blur(8px)',
                transition: {
                    duration: 0.2,
                    ease: 'easeInOut',
                },
            },
        };

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
