<?php
/**
 * Los dados no mienten. Los dados no perdonan.
 */
class Dados {
    public static function d6() {
        return random_int(1, 6);
    }

    public static function tirar($cantidad) {
        $resultados = [];
        for ($i = 0; $i < $cantidad; $i++) {
            $resultados[] = self::d6();
        }
        return $resultados;
    }

    public static function contarExitos($cantidad, $objetivo) {
        $exitos = 0;
        foreach (self::tirar($cantidad) as $dado) {
            if ($dado >= $objetivo) $exitos++;
        }
        return $exitos;
    }
}
