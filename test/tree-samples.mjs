/**
 * One ordinary source file per language the tree-sitter engine reads. Each
 * holds every node type and field `SHAPES` names for its language, and a
 * named node that starts on a line break.
 */
export const python = `# Order totals.
from __future__ import annotations

import os
import json as serializer
from decimal import Decimal
from typing import *

USAGE = (
    "usage: totals FILE "
    "[--currency CODE]"
)
LIMITS = {"low": -1, "flags": [True, None], "pair": (2.5,), "set": {False}}
GREETING = f"{USAGE}"
LOW, HIGH = 1, 2
[FIRST, (*REST, LAST)] = 1, (2, 3)
RATES: Dict[str, a.Rate | None] = {}
HOOKS: Callable[[int], tuple[int, ...]] = None
FIRST: a.Rates[0] = None
MODE: Literal["a"] | None = None
EOL = "\\n"
BRACES = f"{{}}"


class Order(Record):
    """One order and its lines."""

    def __init__(self, lines):
        self.lines = lines

    @property
    def total(self) -> Decimal:
        return sum(line.price for line in self.lines)

    def describe(self, status):
        match status:
            case "paid":
                return "settled"
            case _:
                return "open"


def load(path) -> Order:
    try:
        with open(os.path.expanduser(path)) as handle:
            return Order(handle.readlines(), sort=True)
    except OSError:
        pass
    except ValueError as error:
        raise
    return Order([])


@cached
def reserve(order):
    return order.total


class Ledger(*mixins, **options):
    pass

from . import util
from ..shop.money import format_price as fp

handler = lambda event: event
`;

export const php = `<?php

namespace App\\Billing;

use App\\Models\\Order;
use App\\Models\\Invoice as Bill;

/**
 * Adds up what an order costs.
 */
#[Service]
class Totals extends Money implements Summable
{
    use Rounds;

    public function total(Order $order): int
    {
        try {
            return array_sum($order->prices());
        } catch (\\RuntimeException $e) {
            self::$failed++;
            return 0;
        }
    }

    public function usage(): string
    {
        return <<<TEXT
        usage: totals FILE
        TEXT;
    }
}

interface Summable
{
    public function total(Order $order): int;
}

trait Rounds
{
    private function round(float $value): int
    {
        return (int) round($value);
    }
}

enum Currency: string
{
    case Usd = 'usd';
    case Eur = 'eur';
}

const LIMITS = [1, 'low' => -2.5, true, null];
const NOTE = <<<'TEXT'
plain
TEXT;
$greeting = "hello $name";
[$low, $high] = [1, 2];
const EOL = "\\n";

function format_total(int $cents): string
{
    return number_format($cents / 100, 2);
}

function parse_total(string $text): int
{
    if ($text === '') {
        echo 'empty';
        print 'empty';
        Log::warning('empty');
        throw new \\InvalidArgumentException('empty');
    }
    return (int) $text;
}

final class Rate
{
    public int $cents = 0;
    public static ?int $limit = 1;
    final public const int SCALE = 100;
    protected readonly array $parts;
    var $legacy = 2;
}

$rate->cents = 1;
use function App\\Support\\money;
use const App\\Support\\RATE;
?>
<p>Totals are in cents.</p>
`;

export const go = `// Package billing adds up orders.
package billing

import (
	"errors"
	"fmt"
)

const usage = \`
usage: totals FILE
\`

const (
	low = iota
	mid
	high = -(1 << iota)
)

var limits = map[string]float64{"low": -1, "high": 2.5}
var marks = [...]string{"a\\n"}
var cells = map[string][2]*fmt.State{}
var extra = map[string]interface{}{}
var boxed = struct{ v Box[int] }{}

var (
	ready, done = true, false
	none  error = nil
	mark        = 'x'
	wave        = 2i
)

// Order is one order and its prices.
type Order struct {
	Prices []int
}

// Total is the sum of every price.
func (o Order) Total() int {
	sum := 0
	for _, price := range o.Prices {
		sum += price
	}
	return sum
}

// Describe says what the order costs.
func Describe(o Order) (string, error) {
	if len(o.Prices) == 0 {
		return usage, errors.New("empty order")
	}
	return fmt.Sprintf("%d", o.Total()), nil
}
`;

export const java = `/* Billing totals. */
package com.example.billing;

import java.io.IOException;
import java.util.*;

/** Adds up what an order costs. */
@SuppressWarnings("unchecked")
public class Totals extends Money implements Summable {
    private static final String USAGE = """
        usage: totals FILE
        """;
    static final int[] LIMITS = {1, -0x1F, 07, 0b1};
    double rate = 2.5, scale = 0x1p3;
    char mark = 'x';
    boolean on = true, off = false;
    Object none = null;
    java.util.List<String> names = null;
    String eol = "\\n";
    String greeting = STR."hello \\{USAGE}";

    // The sum of every price, or zero when the order cannot be read.
    @Override
    public int total(Order order) {
        try {
            return order.prices().stream().mapToInt(Integer::intValue).sum();
        } catch (IOException e) {
            return 0;
        }
    }
}

interface Summable {
    int SCALE = 100;

    int total(Order order);
}

enum Currency {
    USD,
    EUR;

    String code() {
        if (this.name() == null) {
            throw new IllegalStateException();
        }
        @SuppressWarnings(value = {"unused", "rawtypes"})
        int tries = 0;
        again:
        while (tries < 2) {
            tries++;
            if (tries == 1) {
                continue again;
            }
            break again;
        }
        return this.label;
    }
}

record Line(String name, int price) {}

@interface Audited {
    String by() default "";
}

class Rates {
    int of(Currency currency) {
        switch (currency) {
            case USD:
                return 100;
            default:
                return 0;
        }
    }
}

class Ledger {
    Ledger(int id) {
    }
}
`;

export const csharp = `// Billing totals.
global using System.Text;
using static System.Math;
using System;
using System.Linq;
using Text = System.Text;

namespace Billing
{
    [Serializable]
    public class Totals : ISummable
    {
        private const string Usage = """
            usage: totals FILE
            """;
        private static readonly int[] Limits = { 1, -2 };
        double Rate = 2.5;
        char Mark = 'x';
        bool On = true;
        string Root = @"c:\\x";
        object None = null;
        System.Collections.Generic.List<int?> Marks = null;

        public int Total(Order order)
        {
            const int scale = 100;
            var eol = "\\n";
            var floor = new Money { Cents = scale };
            int Cents(decimal price)
            {
                return (int)(price * 100);
            }

            try
            {
                return order.Prices.Sum(Cents);
            }
            catch (InvalidOperationException)
            {
                return 0;
            }
            catch (FormatException error) when (error.Data != null)
            {
                throw;
            }
        }

#region Rounding
#nullable enable
#pragma warning disable CS0618
        public int Round(decimal? price) => (int)(price ?? throw new ArgumentNullException());
#line default
#endregion

#if NET8_0
        public int Scale() => 100;
#elif NET6_0
        public int Scale() => 10;
#else
#warning no scale for this target
#error unsupported target
        public int Scale() => 1;
#endif
    }

    public interface ISummable
    {
        int Total(Order order);
    }

    [Obsolete("use Line")]
    public struct Money
    {
        public int Cents;
    }

    public record Line(string Name, decimal Price);
}

// A file holds one kind of namespace, and the grammar reads both.
namespace Billing.Reports;

public enum Kind { Sale, Refund }

public delegate int Rounder(decimal value);

public class Ledger
{
    public Ledger(int id)
    {
    }
}
`;

export const rust = `#![allow(dead_code)]

use std::collections::*;
use std::fmt;
use std::io as stdio;

/* Shown when no file is given. */
const USAGE: &str = "
usage: totals FILE
";

static LIMITS: [i64; 3] = [1, -2, 3];
const RATE: (f64, bool, char) = (2.5, true, 'x');
const RAW: &str = r"raw";
pub(crate) static EOL: &'static str = "\\n";
static mut HEAD: *const u8 = 0;

/// One order and its prices.
#[derive(Debug)]
pub struct Order {
    prices: Vec<i64>,
}

pub trait Summable {
    fn total(&self) -> i64;
}

impl Summable for Order {
    // The sum of every price.
    fn total(&self) -> i64 {
        self.prices.iter().sum()
    }
}

impl fmt::Display for Order {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.total())
    }
}

mod units {
    pub const CENTS: i64 = 100;
}

pub fn describe(order: &Order) -> String {
    let scale = 100;
    let (low, high) = (1, 2);
    let Some(first) = order.prices.first() else {
        return USAGE.to_string();
    };
    if order.prices.is_empty() {
        return USAGE.to_string();
    }
    order.to_string()
}

use crate::billing::{tax, money::round};

enum Kind {
    Sale,
    Refund,
}

type Cents = i64;

macro_rules! double {
    ($x:expr) => {
        $x * 2
    };
}
`;

export const kotlin = `/* Billing totals. */
package com.example.billing

import java.io.IOException
import kotlin.collections.*
import kotlin.math.max as larger

const val LIMIT = -1
val RATE = 2.5
val MARK = 'x'
val READY = true
val GREETING = "hello $RATE and \${LIMIT}"

// Shown when no file is given.
val USAGE = """
    usage: totals FILE
""".trimIndent()

@Suppress("unused")
class Totals(private val orders: List<Order>) : Ledger(), Summable {
    override val unit = "cents\\n"

    fun total(): Int {
        try {
            return orders.sumOf { it.price }
        } catch (e: IOException) {
            return 0
        } catch (e: IllegalStateException) {
            throw e
        }
    }

    private fun isEmpty(): Boolean {
        return orders.isEmpty()
    }

    companion object {
        fun none(): Totals {
            return Totals(emptyList())
        }
    }
}

object Currencies {
    fun default(): String {
        return "usd"
    }
}

fun Order.cents(): Int {
    return price * 100
}

fun Order?.orZero(): Int {
    return this?.price ?: 0
}

fun (() -> Int).twice(): Int {
    return this() + this()
}

typealias Cents = Long

class Ledger(val id: Int) {
    constructor(name: String) : this(0)
}

fun <T> first(items: List<T>): T = items[0]
`;
