<?php
require_once 'Unidad.php';

/**
 * Orkos: más brutos que listos, pero muchísimos.
 */
class GuerreroOrko extends Unidad {
    private $clan;

    public function __construct($nombre, $clan) {
        parent::__construct($nombre, 1, 5, 4, 6);
        $this->clan = $clan;
    }

    public function getClan() {
        return $this->clan;
    }

    public function gritoDeGuerra() {
        return $this->nombre . ' (' . $this->clan . '): ¡WAAAGH!';
    }

    public function enfurecer() {
        $this->fuerza = $this->fuerza + 1;
        return $this->fuerza;
    }
}
