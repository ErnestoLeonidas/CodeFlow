<?php
require_once 'Unidad.php';

/**
 * Adeptus Astartes: el escudo del Emperador.
 */
class MarineEspacial extends Unidad {
    private $capitulo;

    public function __construct($nombre, $capitulo) {
        parent::__construct($nombre, 2, 3, 4, 3);
        $this->capitulo = $capitulo;
    }

    public function getCapitulo() {
        return $this->capitulo;
    }

    public function gritoDeGuerra() {
        return $this->nombre . ' (' . $this->capitulo . '): ¡Sólo en la muerte termina el deber!';
    }
}
