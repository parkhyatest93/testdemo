import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import {mountComponentWithRemixStub} from '#/test-utils';
import {InventoryErrorPopover} from '../InventoryErrorPopover';

const mockInsufficientStockProductVariants = [
  {
    variantId: 'gid://shopify/ProductVariant/1',
    variantTitle: 'Small',
    defaultId: 'gid://shopify/Product/1',
    defaultTitle: 'Test Product',
    image: {
      url: 'https://cdn.shopify.com/image1.jpg',
      altText: 'Small variant image',
    },
  },
  {
    variantId: 'gid://shopify/ProductVariant/2',
    variantTitle: 'Another Product',
    defaultId: 'gid://shopify/Product/2',
    defaultTitle: 'Default Title',
    image: {
      url: 'https://cdn.shopify.com/image2.jpg',
      altText: 'Default variant image',
    },
  },
];

describe('InventoryErrorPopover', () => {
  it('shows popover content on mouse enter', async () => {
    mountComponentWithRemixStub(
      <InventoryErrorPopover
        insufficientStockProductVariants={mockInsufficientStockProductVariants}
      />,
    );
    const warningIcon = screen.getByLabelText('warning-icon');
    await userEvent.hover(warningIcon);

    expect(
      screen.getByText('Not enough inventory to create order'),
    ).toBeInTheDocument();

    expect(screen.getByText('Test Product')).toBeInTheDocument();
    expect(screen.getByText('Another Product')).toBeInTheDocument();
  });

  it('hides popover content on mouse leave', async () => {
    mountComponentWithRemixStub(
      <InventoryErrorPopover
        insufficientStockProductVariants={mockInsufficientStockProductVariants}
      />,
    );

    const warningIcon = screen.getByLabelText('warning-icon');

    // Show popover
    await userEvent.hover(warningIcon!);
    expect(screen.getByText('Test Product')).toBeInTheDocument();

    // Hide popover
    await userEvent.unhover(warningIcon!);
    expect(screen.queryByText('Test Product')).not.toBeInTheDocument();
  });

  it('displays "Default" for variants with title "Default Title"', async () => {
    mountComponentWithRemixStub(
      <InventoryErrorPopover
        insufficientStockProductVariants={mockInsufficientStockProductVariants}
      />,
    );

    const warningIcon = screen.getByLabelText('warning-icon');
    await userEvent.hover(warningIcon);

    expect(screen.getByText('Default Title')).toBeInTheDocument();
  });

  it('displays variant title for non-default variants', async () => {
    mountComponentWithRemixStub(
      <InventoryErrorPopover
        insufficientStockProductVariants={mockInsufficientStockProductVariants}
      />,
    );

    const warningIcon = screen.getByLabelText('warning-icon');
    await userEvent.hover(warningIcon);

    expect(screen.getByText('Small')).toBeInTheDocument();
  });

  it('displays product images with correct alt text', async () => {
    mountComponentWithRemixStub(
      <InventoryErrorPopover
        insufficientStockProductVariants={mockInsufficientStockProductVariants}
      />,
    );

    const warningIcon = screen.getByLabelText('warning-icon');
    await userEvent.hover(warningIcon);

    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(2); // 2 product images

    expect(images[0]).toHaveAttribute(
      'src',
      'https://cdn.shopify.com/image1.jpg',
    );
    expect(images[0]).toHaveAttribute('alt', 'Small variant image');

    expect(images[1]).toHaveAttribute(
      'src',
      'https://cdn.shopify.com/image2.jpg',
    );
    expect(images[1]).toHaveAttribute('alt', 'Default variant image');
  });

  it('uses ImageIcon when product has no image', async () => {
    const productsWithoutImage = [
      {
        ...mockInsufficientStockProductVariants[0],
        image: undefined,
      },
    ];

    mountComponentWithRemixStub(
      <InventoryErrorPopover
        insufficientStockProductVariants={productsWithoutImage}
      />,
    );

    const warningIcon = screen.getByLabelText('warning-icon');
    await userEvent.hover(warningIcon);
  });

  it('renders Link with correct product URL', async () => {
    mountComponentWithRemixStub(
      <InventoryErrorPopover
        insufficientStockProductVariants={mockInsufficientStockProductVariants}
      />,
    );

    const warningIcon = screen.getByLabelText('warning-icon');
    await userEvent.hover(warningIcon);

    const link = screen.getByRole('link', {name: 'Test Product'});
    expect(link).toHaveAttribute(
      'href',
      'https://example.myshopify.com/admin/products/1',
    );
  });
});
