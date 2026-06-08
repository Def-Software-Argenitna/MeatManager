import React, { useState, useEffect } from 'react';
import { MapPin } from 'lucide-react';
import { fetchClientBranches } from '../utils/apiClient';
import { useUser, isEffectiveAdminUser } from '../context/UserContext';

const BranchFilter = ({ onBranchChange }) => {
  const { currentUser, accessProfile, activeBranch, selectActiveBranch } = useUser();
  const isAdmin = isEffectiveAdminUser(currentUser, accessProfile);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    fetchClientBranches().then((data) => {
      const list = Array.isArray(data?.branches) ? data.branches : Array.isArray(data) ? data : [];
      setBranches(list);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [isAdmin]);

  const handleChange = (e) => {
    const val = e.target.value;
    if (onBranchChange) {
      onBranchChange(val ? Number(val) : null);
    } else {
      const branch = branches.find((b) => String(b.id) === val);
      selectActiveBranch(branch || null);
    }
  };

  if (!isAdmin || loading || branches.length <= 1) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      marginBottom: '1rem',
      padding: '0.5rem 0.75rem',
      background: 'rgba(34, 197, 94, 0.08)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid rgba(34, 197, 94, 0.2)',
      fontSize: '0.8rem',
    }}>
      <MapPin size={16} style={{ color: '#22c55e', flexShrink: 0 }} />
      <span style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>Sucursal:</span>
      <select
        value={activeBranch?.id || ''}
        onChange={handleChange}
        style={{
          flex: 1,
          fontSize: '0.8rem',
          padding: '0.25rem 0.5rem',
          background: 'rgba(255,255,255,0.05)',
          color: 'var(--color-text-main)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '6px',
          cursor: 'pointer',
        }}
      >
        <option value="">Seleccionar sucursal...</option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default BranchFilter;
