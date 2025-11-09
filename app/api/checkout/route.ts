import { NextRequest, NextResponse } from 'next/server';
import { supabase, Product } from '@/lib/supabase';

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
const MIDTRANS_API_URL = 'https://app.sandbox.midtrans.com/snap/v1/transactions';

interface CheckoutItem {
  product: Product;
  quantity: number;
}

interface CustomerData {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postal_code: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { customer, items }: { customer: CustomerData; items: CheckoutItem[] } = body;

    if (!customer || !items || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid request data' },
        { status: 400 }
      );
    }

    const totalAmount = items.reduce(
      (sum, item) => sum + item.product.price * item.quantity,
      0
    );

    const orderId = `ORDER-${Date.now()}`;

    const { data: userData, error: userError } = await supabase
      .from('users')
      .upsert(
        {
          email: customer.email,
          name: customer.name,
          phone: customer.phone,
        },
        { onConflict: 'email' }
      )
      .select()
      .single();

    if (userError) {
      console.error('User creation error:', userError);
      return NextResponse.json(
        { success: false, error: 'Failed to create user' },
        { status: 500 }
      );
    }

    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: userData.id,
        total_amount: totalAmount,
        status: 'pending',
        payment_method: 'midtrans',
        midtrans_order_id: orderId,
        shipping_address: {
          name: customer.name,
          phone: customer.phone,
          address: customer.address,
          city: customer.city,
          postal_code: customer.postal_code,
        },
      })
      .select()
      .single();

    if (orderError) {
      console.error('Order creation error:', orderError);
      return NextResponse.json(
        { success: false, error: 'Failed to create order' },
        { status: 500 }
      );
    }

    const orderItems = items.map((item) => ({
      order_id: orderData.id,
      product_id: item.product.id,
      quantity: item.quantity,
      price: item.product.price,
    }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems);

    if (itemsError) {
      console.error('Order items creation error:', itemsError);
      return NextResponse.json(
        { success: false, error: 'Failed to create order items' },
        { status: 500 }
      );
    }

    const midtransPayload = {
      transaction_details: {
        order_id: orderId,
        gross_amount: totalAmount,
      },
      customer_details: {
        first_name: customer.name,
        email: customer.email,
        phone: customer.phone,
      },
      item_details: items.map((item) => ({
        id: item.product.id,
        price: item.product.price,
        quantity: item.quantity,
        name: item.product.name,
      })),
    };

    const midtransAuth = Buffer.from(MIDTRANS_SERVER_KEY + ':').toString('base64');

    const midtransResponse = await fetch(MIDTRANS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${midtransAuth}`,
      },
      body: JSON.stringify(midtransPayload),
    });

    const midtransData = await midtransResponse.json();

    if (!midtransResponse.ok) {
      console.error('Midtrans error:', midtransData);
      return NextResponse.json(
        { success: false, error: 'Failed to create payment' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      snapToken: midtransData.token,
      orderId: orderData.id,
    });
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
