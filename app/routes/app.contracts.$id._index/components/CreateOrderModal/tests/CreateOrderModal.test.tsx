import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {vi, expect, it, describe} from 'vitest';
import {CreateOrderModal} from '../CreateOrderModal';
import {mountComponentWithRemixStub} from '#/test-utils';
import type {InsufficientStockProductVariants} from '~/types';

describe('CreateOrderModal', () => {
  const variants: InsufficientStockProductVariants[] = [
    {
      id: '1',
      product: {
        id: 'gid://shopify/Product/1',
        title: 'Test Product',
      },
      title: 'Small',
      image: {
        originalSrc: 'test-image.jpg',
        altText: 'Test Image',
      },
    },
  ];

  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onCreateOrder: vi.fn(),
    insufficientStockProductVariants: variants,
  };

  it('calls onCreateOrder and onClose when create order button is clicked', async () => {
    const onCloseSpy = vi.fn();
    const onCreateOrderSpy = vi.fn();
    mountComponentWithRemixStub(
      <CreateOrderModal
        {...defaultProps}
        onClose={onCloseSpy}
        onCreateOrder={onCreateOrderSpy}
        insufficientStockProductVariants={[]}
      />,
    );

    const createButton = screen.getByRole('button', {
      name: 'Create order',
    });

    await userEvent.click(createButton);

    expect(onCreateOrderSpy).toHaveBeenCalled();
    expect(onCloseSpy).toHaveBeenCalled();
  });

  it('calls onClose when cancel button is clicked', async () => {
    const onCloseSpy = vi.fn();
    const onCreateOrderSpy = vi.fn();
    mountComponentWithRemixStub(
      <CreateOrderModal
        {...defaultProps}
        onClose={onCloseSpy}
        onCreateOrder={onCreateOrderSpy}
        insufficientStockProductVariants={[]}
      />,
    );

    const closeButton = screen.getByRole('button', {name: 'Cancel'});
    await userEvent.click(closeButton);

    expect(onCloseSpy).toHaveBeenCalled();
    expect(onCreateOrderSpy).not.toHaveBeenCalled();
  });

  it('displays warning message and out of stock products', async () => {
    mountComponentWithRemixStub(<CreateOrderModal {...defaultProps} />);

    expect(screen.getByText('Test Product')).toBeInTheDocument();

    expect(screen.getByText('Small')).toBeInTheDocument();
  });
});
