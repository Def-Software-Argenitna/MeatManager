const Skeleton = ({ width = '100%', height = '1rem', borderRadius = '6px', className = '', style = {} }) => (
    <span
        className={`ui-skeleton ${className}`}
        style={{ width, height, borderRadius, display: 'block', ...style }}
    />
);

export const SkeletonLine = ({ width = '100%', className = '' }) => (
    <Skeleton width={width} height="0.85rem" borderRadius="4px" className={className} />
);

export const SkeletonCard = ({ height = '120px', className = '' }) => (
    <Skeleton width="100%" height={height} borderRadius="14px" className={className} />
);

export default Skeleton;
