import { checkProductNow } from "./procedures/check-now";
import { createProduct } from "./procedures/create";
import { deleteProduct } from "./procedures/delete";
import { getProduct } from "./procedures/get";
import { listProducts } from "./procedures/list";
import { updateProduct } from "./procedures/update";

export const productsRouter = {
  create: createProduct,
  list: listProducts,
  get: getProduct,
  update: updateProduct,
  delete: deleteProduct,
  checkNow: checkProductNow,
};
