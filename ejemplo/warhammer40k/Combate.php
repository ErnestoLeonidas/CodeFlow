<?php
require_once 'Dados.php';
require_once 'Registro.php';

/**
 * Resuelve disparos y cuerpo a cuerpo con la secuencia clásica:
 * impactar, herir, salvación.
 */
class Combate {
    /** @var Registro */
    private $registro;

    public function __construct(Registro $registro) {
        $this->registro = $registro;
    }

    public function resolverDisparo($atacante, $defensor, $disparos) {
        $impactos = Dados::contarExitos($disparos, $atacante->getHabilidad());
        return $this->aplicarImpactos($atacante, $defensor, $impactos);
    }

    public function resolverMelee($atacante, $defensor, $ataques) {
        $impactos = Dados::contarExitos($ataques, $atacante->getHabilidad());
        return $this->aplicarImpactos($atacante, $defensor, $impactos);
    }

    private function aplicarImpactos($atacante, $defensor, $impactos) {
        $heridas = $this->tirarParaHerir($atacante, $impactos);
        $danos = $this->tirarSalvacion($defensor, $heridas);
        if ($danos > 0) {
            $defensor->recibirHerida($danos);
        }
        $this->registro->anotar($atacante->getNombre() . ' inflige ' . $danos . ' a ' . $defensor->getNombre());
        return $danos;
    }

    private function tirarParaHerir($atacante, $impactos) {
        return Dados::contarExitos($impactos, 7 - $atacante->getFuerza());
    }

    private function tirarSalvacion($defensor, $heridas) {
        $falladas = 0;
        foreach (Dados::tirar($heridas) as $dado) {
            if ($dado < $defensor->getSalvacion()) $falladas++;
        }
        return $falladas;
    }
}
