import React from 'react';
import DespostadaBase from '../components/despostada/DespostadaBase';
import { VACA_CUTS } from './despostadaData';

const DespostadaVaca = () => (
    <DespostadaBase
        species="vaca"
        title="Despostada Vaca"
        subtitle="Controlá la media res, registrá cada corte y seguí el rendimiento con una interfaz más clara, más rápida y más profesional."
        heroImage="/vaca_argentina.png"
        cutMap={VACA_CUTS}
        lotSpecies="vaca"
        lotLabel="Media res disponible"
        lotEmptyLabel="-- No hay medias reses disponibles --"
        lotPlaceholderLabel="-- Seleccionar media res o ingresar peso manual --"
        manualHint="Recordá registrar la compra de la media res para que aparezca acá."
        noWeightMessage="Por favor ingresá el peso inicial o seleccioná una media res de stock."
        finishConfirm="¿Finalizar esta despostada? Se actualizará el stock de piezas enteras."
        finishSuccess="Despostada finalizada con éxito."
        lockedDescription="La trazabilidad de lotes se habilita desde Gestión de Clientes."
        lockedCtaLabel="Ver estado de licencias"
        purchaseHints={['vaca', 'res', 'media res']}
        accent="#ef4444"
    />
);

export default DespostadaVaca;
