import React, { useState, useEffect } from 'react';
import { MapPin } from 'lucide-react';
import { fetchClientBranches } from '../utils/apiClient';
import { useUser } from '../context/UserContext';

const BranchFilter = ({ onBranchChange }) => {
  const { adminGlobalMode } = useUser();
  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');

  useEffect(() => {
    if (!adminGlobalMode) return;
    fetchClientBranches().then((data) => {
      const list = Array.isArray(data?.branches) ? data.branches : [];
      setBranches(list);
    }).catch(() => {});
  }, [adminGlobalMode]);

  useEffect(() => {
    if (onBranchChange) {
      onBranchChange(selectedBranchId ? Number(selectedBranchId) : null);
    }
  }, [selectedBranchId, onBranchChange]);

  if (!adminGlobalMode || branches.length <= 1) return null;

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
      <span style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>Filtrar sucursal:</span>
      <select
        value={selectedBranchId}
        onChange={(e) => setSelectedBranchId(e.target.value)}
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
        <option value="">Todas las sucursales</option>
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
