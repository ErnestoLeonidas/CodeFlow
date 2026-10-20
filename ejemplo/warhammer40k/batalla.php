<?php
require_once 'Cruzada.php';
require_once 'FabricaUnidades.php';

function prepararEjercitos($marines, $orkos) {
    return [
        FabricaUnidades::crearImperio($marines),
        FabricaUnidades::crearHordaOrka($orkos),
    ];
}

function iniciarCruzada($marines = 5, $orkos = 12) {
    list($imperio, $horda) = prepararEjercitos($marines, $orkos);
    $cruzada = new Cruzada();
    $vencedor = $cruzada->librarBatalla($imperio, $horda);
    imprimirInforme($cruzada, $vencedor);
    return $vencedor;
}

function imprimirInforme($cruzada, $vencedor) {
    echo $cruzada->cronica() . "\n";
    echo "Victoria para: " . $vencedor . "\n";
}

iniciarCruzada();
