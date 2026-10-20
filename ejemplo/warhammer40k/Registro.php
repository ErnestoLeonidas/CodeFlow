<?php
/**
 * Crónica de batalla: el Adeptus Administratum lo anota todo.
 */
class Registro {
    private $lineas = [];

    public function anotar($texto) {
        $this->lineas[] = '[' . count($this->lineas) . '] ' . $texto;
    }

    public function volcar() {
        return implode("\n", $this->lineas);
    }
}
