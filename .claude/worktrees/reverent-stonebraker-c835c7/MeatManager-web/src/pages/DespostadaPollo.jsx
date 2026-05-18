import React from 'react';
import DespostadaBase from '../components/despostada/DespostadaBase';
import { POLLO_CUTS } from './despostadaData';

const DespostadaPollo = () => (
    <DespostadaBase
        species="pollo"
        title="Despostada Pollo"
        subtitle="Registrá el trozado con una vista operativa más limpia, medición en vivo y trazabilidad lista para producción."
        heroImage="/pollo_argentino.png"
        cutMap={POLLO_CUTS}
        lotSpecies="pollo"
        lotLabel="Pollo entero disponible"
        lotEmptyLabel="-- No hay pollos disponibles --"
        lotPlaceholderLabel="-- Seleccionar pollo entero o ingresar peso manual --"
        manualHint="Recordá registrar la compra del pollo entero para que aparezca acá."
        noWeightMessage="Por favor ingresá el peso inicial o seleccioná un pollo de stock."
        finishConfirm="¿Finalizar trozado de pollo?"
        finishSuccess="Proceso finalizado."
        lockedDescription="La despostada se habilita desde Gestión de Clientes, no por código local."
        lockedCtaLabel="Ver estado de licencias"
        purchaseHints={['pollo', 'aves', 'ave']}
        accent="#f59e0b"
    />
);

export default DespostadaPollo;
