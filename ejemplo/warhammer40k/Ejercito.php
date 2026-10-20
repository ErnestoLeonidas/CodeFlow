<?php
require_once 'Unidad.php';

class Ejercito {
    private $nombre;
    private $unidades = [];

    public function __construct($nombre) {
        $this->nombre = $nombre;
    }

    public function getNombre() {
        return $this->nombre;
    }

    public function agregar($unidad) {
        $this->unidades[] = $unidad;
        return $this;
    }

    public function vivas() {
        return array_values(array_filter($this->unidades, function ($u) {
            return $u->estaViva();
        }));
    }

    public function elegirObjetivo() {
        $vivas = $this->vivas();
        return $vivas ? $vivas[array_rand($vivas)] : null;
    }

    public function estaDerrotado() {
        return count($this->vivas()) === 0;
    }

    public function puntosTotales() {
        $total = 0;
        foreach ($this->vivas() as $unidad) {
            $total += $unidad->puntos();
        }
        return $total;
    }
}
