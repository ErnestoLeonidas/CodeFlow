<?php
/**
 * Unidad base: todo combatiente del 41º Milenio hereda de aquí.
 */
class Unidad {
    protected $nombre;
    protected $heridas;
    protected $habilidad;
    protected $fuerza;
    protected $salvacion;

    public function __construct($nombre, $heridas, $habilidad, $fuerza, $salvacion) {
        $this->nombre = $nombre;
        $this->heridas = $heridas;
        $this->habilidad = $habilidad;
        $this->fuerza = $fuerza;
        $this->salvacion = $salvacion;
    }

    public function getNombre() {
        return $this->nombre;
    }

    public function getHabilidad() {
        return $this->habilidad;
    }

    public function getFuerza() {
        return $this->fuerza;
    }

    public function getSalvacion() {
        return $this->salvacion;
    }

    public function estaViva() {
        return $this->heridas > 0;
    }

    public function recibirHerida($cantidad) {
        $this->heridas = max(0, $this->heridas - $cantidad);
        return $this->estaViva();
    }

    public function puntos() {
        return $this->heridas * 10 + $this->fuerza * 5;
    }
}
