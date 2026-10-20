<?php
require_once 'MarineEspacial.php';
require_once 'GuerreroOrko.php';
require_once 'Ejercito.php';

class FabricaUnidades {
    private static $capitulos = ['Ultramarines', 'Ángeles Sangrientos', 'Lobos Espaciales'];
    private static $clanes = ['Goffs', 'Evil Sunz', 'Blood Axes'];

    public static function crearMarine($indice) {
        $capitulo = self::$capitulos[$indice % count(self::$capitulos)];
        return new MarineEspacial('Hermano-' . ($indice + 1), $capitulo);
    }

    public static function crearOrko($indice) {
        $clan = self::$clanes[$indice % count(self::$clanes)];
        return new GuerreroOrko('Boy-' . ($indice + 1), $clan);
    }

    public static function crearImperio($cantidad) {
        $ejercito = new Ejercito('Imperio de la Humanidad');
        for ($i = 0; $i < $cantidad; $i++) {
            $ejercito->agregar(self::crearMarine($i));
        }
        return $ejercito;
    }

    public static function crearHordaOrka($cantidad) {
        $ejercito = new Ejercito('Waaagh! de Ghazghkull');
        for ($i = 0; $i < $cantidad; $i++) {
            $ejercito->agregar(self::crearOrko($i));
        }
        return $ejercito;
    }
}
