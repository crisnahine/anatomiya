/**
 * One ordinary source file per language the tree-sitter engine reads. Each
 * holds every node type and field `SHAPES` names for its language, and a
 * named node that starts on a line break.
 */
export const python = `# Order totals.
from __future__ import annotations

import os
from decimal import Decimal
from typing import *

USAGE = (
    "usage: totals FILE "
    "[--currency CODE]"
)


class Order:
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
            return Order(handle.readlines())
    except OSError:
        pass
    return Order([])
`;

export const php = `<?php

namespace App\\Billing;

use App\\Models\\Order;

/**
 * Adds up what an order costs.
 */
#[Service]
class Totals implements Summable
{
    use Rounds;

    public function total(Order $order): int
    {
        try {
            return array_sum($order->prices());
        } catch (\\RuntimeException $e) {
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

function format_total(int $cents): string
{
    return number_format($cents / 100, 2);
}
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
public class Totals implements Summable {
    private static final String USAGE = """
        usage: totals FILE
        """;

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
    int total(Order order);
}

enum Currency {
    USD,
    EUR
}

record Line(String name, int price) {}

@interface Audited {
    String by() default "";
}
`;

export const csharp = `// Billing totals.
using System;
using System.Linq;

namespace Billing
{
    [Serializable]
    public class Totals : ISummable
    {
        private const string Usage = """
            usage: totals FILE
            """;

        public int Total(Order order)
        {
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
        }
    }

    public interface ISummable
    {
        int Total(Order order);
    }

    public struct Money
    {
        public int Cents;
    }

    public record Line(string Name, decimal Price);
}
`;

export const rust = `#![allow(dead_code)]

use std::collections::*;
use std::fmt;

/* Shown when no file is given. */
const USAGE: &str = "
usage: totals FILE
";

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

pub fn describe(order: &Order) -> String {
    if order.prices.is_empty() {
        return USAGE.to_string();
    }
    order.to_string()
}
`;

export const kotlin = `/* Billing totals. */
package com.example.billing

import java.io.IOException
import kotlin.collections.*

// Shown when no file is given.
val USAGE = """
    usage: totals FILE
""".trimIndent()

@Suppress("unused")
class Totals(private val orders: List<Order>) {
    fun total(): Int {
        try {
            return orders.sumOf { it.price }
        } catch (e: IOException) {
            return 0
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
`;
