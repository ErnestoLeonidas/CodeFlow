<?php
require_once 'Combate.php';
require_once 'Registro.php';
require_once 'FabricaUnidades.php';

/**
 * Orquesta la batalla completa entre dos ejércitos.
 */
class Cruzada {
    /** @var Combate */
    private $combate;
    private $registro;

    public function __construct() {
        $this->registro = new Registro();
        $this->combate = new Combate($this->registro);
    }

    public function librarBatalla($imperio, $horda, $maxRondas = 10) {
        for ($ronda = 1; $ronda <= $maxRondas; $ronda++) {
            $this->registro->anotar('--- Ronda ' . $ronda . ' ---');
            $this->faseDeDisparo($imperio, $horda);
            $this->faseDeAsalto($horda, $imperio);
            if ($imperio->estaDerrotado() || $horda->estaDerrotado()) break;
        }
        return $this->declararVencedor($imperio, $horda);
    }

    private function faseDeDisparo($atacantes, $defensores) {
        foreach ($atacantes->vivas() as $unidad) {
            $objetivo = $defensores->elegirObjetivo();
            if (!$objetivo) return;
            $this->combate->resolverDisparo($unidad, $objetivo, 2);
        }
    }

    private function faseDeAsalto($atacantes, $defensores) {
        foreach ($atacantes->vivas() as $unidad) {
            $objetivo = $defensores->elegirObjetivo();
            if (!$objetivo) return;
            $this->combate->resolverMelee($unidad, $objetivo, 3);
        }
    }

    private function declararVencedor($imperio, $horda) {
        if ($horda->estaDerrotado()) return $imperio->getNombre();
        if ($imperio->estaDerrotado()) return $horda->getNombre();
        return $imperio->puntosTotales() >= $horda->puntosTotales() ? $imperio->getNombre() : $horda->getNombre();
    }

    public function cronica() {
        return $this->registro->volcar();
    }
}
