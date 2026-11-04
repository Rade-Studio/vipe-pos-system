import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:public';

/** Opt a route out of the access-cookie check and the request unit of work. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
