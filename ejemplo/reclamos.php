<?php
function registrarReclamo($datos) {
    validarReclamo($datos);
    return guardarReclamo($datos);
}
function validarReclamo($datos) {
    if (empty($datos['rut'])) throw new Exception('RUT requerido');
}
function guardarReclamo($datos) {
    return true;
}
