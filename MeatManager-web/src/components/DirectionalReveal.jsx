import React from 'react';
import { motion } from 'framer-motion';

const revealVariants = {
    left: {
        initial: { opacity: 0, x: -90, scale: 0.88 },
        animate: { opacity: 1, x: 0, scale: 1 },
    },
    right: {
        initial: { opacity: 0, x: 90, scale: 0.88 },
        animate: { opacity: 1, x: 0, scale: 1 },
    },
    up: {
        initial: { opacity: 0, y: -70, scale: 0.9 },
        animate: { opacity: 1, y: 0, scale: 1 },
    },
    down: {
        initial: { opacity: 0, y: 70, scale: 0.9 },
        animate: { opacity: 1, y: 0, scale: 1 },
    },
};

const DirectionalReveal = ({ from = 'up', delay = 0, className = '', style, children }) => {
    const variant = revealVariants[from] || revealVariants.up;

    return (
        <motion.div
            data-mm-local-motion="true"
            className={className}
            style={style}
            initial={variant.initial}
            animate={variant.animate}
            transition={{
                duration: 0.52,
                delay,
                ease: [0.22, 1, 0.36, 1],
            }}
        >
            {children}
        </motion.div>
    );
};

export default DirectionalReveal;
